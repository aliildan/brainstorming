import { describe, expect, it } from "vitest";
import {
  FakeAdapter,
  Room,
  TranscriptStore,
  type AgentEvent,
  type ChatMessage,
  type PromptInput,
} from "@brainstorming/core";
import { OllamaAdapter, type OllamaChatChunk, type OllamaClientLike, type OllamaMessage } from "@brainstorming/adapters";

function fakeClient(chunks: string[], opts: { error?: string } = {}) {
  const state = { aborted: false, lastMessages: [] as OllamaMessage[], calls: 0 };
  const client: OllamaClientLike = {
    async chat(req) {
      state.calls += 1;
      state.lastMessages = req.messages;
      if (opts.error) throw new Error(opts.error);
      async function* gen(): AsyncIterable<OllamaChatChunk> {
        for (const c of chunks) {
          if (state.aborted) return;
          yield { message: { content: c } };
        }
      }
      return gen();
    },
    abort() {
      state.aborted = true;
    },
  };
  return { client, state };
}

function addressed(content: string): ChatMessage {
  return { id: content, ts: 1, author: "user", content, mentions: [], kind: "chat" };
}
const input = (content: string, digest: ChatMessage[] = []): PromptInput => ({ digest, addressed: addressed(content) });

async function drain(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of it) events.push(ev);
  return events;
}

describe("OllamaAdapter", () => {
  it("streams chunks, ends with done, and sends attributed history", async () => {
    const { client, state } = fakeClient(["keep ", "it ", "simple."]);
    const adapter = new OllamaAdapter("ollama", { model: "qwen:test", client });
    await adapter.start({ workspaceDir: "/tmp", persona: "You are @ollama." });
    const events = await drain(adapter.prompt(input("what do you think?"), new AbortController().signal));

    expect(events.filter((e) => e.type === "text-delta").length).toBe(3);
    expect(events.at(-1)).toEqual({ type: "done", finalText: "keep it simple." });
    expect(state.lastMessages[0]).toEqual({ role: "system", content: "You are @ollama." });
    expect(state.lastMessages.at(-1)).toEqual({ role: "user", content: "[user]: what do you think?" });
  });

  it("rebuilds history from ctx.transcript (own messages as assistant)", async () => {
    const { client, state } = fakeClient(["ok"]);
    const prior: ChatMessage[] = [
      { id: "1", ts: 1, author: "user", content: "hi team", mentions: [], kind: "chat" },
      { id: "2", ts: 2, author: "ollama", content: "hello!", mentions: [], kind: "chat" },
    ];
    const adapter = new OllamaAdapter("ollama", { model: "m", client });
    await adapter.start({ workspaceDir: "/tmp", persona: "P", transcript: prior });
    await drain(adapter.prompt(input("continue"), new AbortController().signal));

    expect(state.lastMessages).toEqual([
      { role: "system", content: "P" },
      { role: "user", content: "[user]: hi team" },
      { role: "assistant", content: "hello!" }, // its own past turn
      { role: "user", content: "[user]: continue" },
    ]);
  });

  it("emits an error event when the client throws", async () => {
    const { client } = fakeClient([], { error: "connection refused" });
    const adapter = new OllamaAdapter("ollama", { model: "m", client });
    await adapter.start({ workspaceDir: "/tmp", persona: "" });
    const events = await drain(adapter.prompt(input("x"), new AbortController().signal));
    expect(events).toEqual([{ type: "error", error: { message: "Error: connection refused", fatal: false } }]);
  });

  it("carries its own reply into the next turn's history", async () => {
    const { client, state } = fakeClient(["first-reply"]);
    const adapter = new OllamaAdapter("ollama", { model: "m", client });
    await adapter.start({ workspaceDir: "/tmp", persona: "" });
    await drain(adapter.prompt(input("q1"), new AbortController().signal));
    await drain(adapter.prompt(input("q2"), new AbortController().signal));
    expect(state.lastMessages).toContainEqual({ role: "assistant", content: "first-reply" });
  });

  it("plugs into the Room", async () => {
    const { client } = fakeClient(["ship ", "it"]);
    const ollama = new OllamaAdapter("ollama", { model: "m", client });
    const claude = new FakeAdapter("claude", { defaultReply: "agreed" });
    const room = new Room({ transcript: new TranscriptStore(), adapters: [ollama, claude], roundBudget: 3 });
    const chat: [string, string][] = [];
    room.on((ev) => {
      if (ev.type === "message" && ev.message.kind === "chat") chat.push([ev.message.author, ev.message.content]);
    });
    await room.start({ workspaceDir: "/tmp", persona: "" });
    await room.sendUserMessage("@ollama thoughts?");
    expect(chat).toEqual([
      ["user", "@ollama thoughts?"],
      ["ollama", "ship it"],
    ]);
  });
});
