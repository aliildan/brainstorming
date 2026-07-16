import { describe, expect, it } from "vitest";
import {
  FakeAdapter,
  Room,
  TranscriptStore,
  type AgentEvent,
  type ChatMessage,
  type PermissionDecision,
  type PromptInput,
} from "@brainstorming/core";
import {
  ClaudeAdapter,
  type ClaudeCanUseTool,
  type ClaudeMessage,
  type ClaudePermissionResult,
  type ClaudeQueryFn,
  type ClaudeQueryParams,
} from "@brainstorming/adapters";

interface Script {
  sessionId?: string;
  text?: string;
  toolName?: string;
  askTool?: string;
  error?: string;
}

function fakeQuery(script: Script) {
  const state = { paramsLog: [] as ClaudeQueryParams[], toolResult: null as ClaudePermissionResult | null };
  const id = script.sessionId ?? "sess-1";
  const queryFn: ClaudeQueryFn = (params) => {
    state.paramsLog.push(params);
    return (async function* (): AsyncIterable<ClaudeMessage> {
      yield { type: "system", subtype: "init", session_id: id };
      if (script.askTool) {
        const canUse = params.options.canUseTool as ClaudeCanUseTool;
        state.toolResult = await canUse(script.askTool, { path: "file.ts" }, { signal: new AbortController().signal });
      }
      if (script.text) yield { type: "assistant", session_id: id, message: { content: [{ type: "text", text: script.text }] } };
      if (script.toolName)
        yield { type: "assistant", session_id: id, message: { content: [{ type: "tool_use", name: script.toolName, input: {} }] } };
      if (script.error) {
        yield { type: "result", subtype: "error", session_id: id, is_error: true, result: script.error };
        return;
      }
      yield { type: "result", subtype: "success", session_id: id, is_error: false, result: script.text ?? "" };
    })();
  };
  return { queryFn, state };
}

function addressed(content: string): ChatMessage {
  return { id: content, ts: 1, author: "user", content, mentions: [], kind: "chat" };
}
const INPUT: PromptInput = { digest: [], addressed: addressed("hello") };
const CTX = { workspaceDir: "/tmp/ws", persona: "You are @claude." };

async function drain(it: AsyncIterable<AgentEvent>, decide?: PermissionDecision): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of it) {
    events.push(ev);
    if (ev.type === "permission-request" && decide) ev.respond(decide);
  }
  return events;
}

describe("ClaudeAdapter", () => {
  it("captures the session id, streams text, ends with done", async () => {
    const { queryFn } = fakeQuery({ text: "hi there", sessionId: "s-1" });
    const adapter = new ClaudeAdapter("claude", { queryFn });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal));
    expect(events.some((e) => e.type === "text-delta" && e.text === "hi there")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", finalText: "hi there" });
    expect(adapter.sessionId).toBe("s-1");
  });

  it("first turn has no resume + carries persona; second turn resumes without persona", async () => {
    const { queryFn, state } = fakeQuery({ text: "ok" });
    const adapter = new ClaudeAdapter("claude", { queryFn });
    await adapter.start(CTX);
    await drain(adapter.prompt(INPUT, new AbortController().signal));
    await drain(adapter.prompt({ digest: [], addressed: addressed("again") }, new AbortController().signal));

    expect(state.paramsLog[0].options.resume).toBeUndefined();
    expect(state.paramsLog[0].options.systemPrompt).toMatchObject({ type: "preset", append: "You are @claude." });
    expect(state.paramsLog[1].options.resume).toBe("sess-1");
    expect(state.paramsLog[1].options.systemPrompt).toBeUndefined();
  });

  it("routes a tool permission to a permission-request; allow returns behavior allow", async () => {
    const { queryFn, state } = fakeQuery({ askTool: "Edit", text: "edited" });
    const adapter = new ClaudeAdapter("claude", { queryFn });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal), "allow-once");
    const req = events.find((e) => e.type === "permission-request");
    expect(req && req.type === "permission-request" && req.request.action).toBe("use Edit");
    expect(state.toolResult).toEqual({ behavior: "allow", updatedInput: { path: "file.ts" } });
    expect(events.at(-1)).toEqual({ type: "done", finalText: "edited" });
  });

  it("deny returns behavior deny to the SDK", async () => {
    const { queryFn, state } = fakeQuery({ askTool: "Bash", text: "skipped" });
    const adapter = new ClaudeAdapter("claude", { queryFn });
    await adapter.start(CTX);
    await drain(adapter.prompt(INPUT, new AbortController().signal), "deny");
    expect(state.toolResult).toEqual({ behavior: "deny", message: "Denied by the user." });
  });

  it("maps a tool_use block to an activity", async () => {
    const { queryFn } = fakeQuery({ toolName: "Read", text: "read it" });
    const adapter = new ClaudeAdapter("claude", { queryFn });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal));
    expect(events).toContainEqual({ type: "activity", activity: { kind: "tool", title: "Read", status: "running" } });
  });

  it("maps an error result to an error event and no done", async () => {
    const { queryFn } = fakeQuery({ error: "usage limit reached" });
    const adapter = new ClaudeAdapter("claude", { queryFn });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal));
    expect(events).toEqual([{ type: "error", error: { message: "usage limit reached", fatal: false } }]);
  });

  it("plugs into the Room", async () => {
    const { queryFn } = fakeQuery({ text: "on it" });
    const claude = new ClaudeAdapter("claude", { queryFn });
    const codex = new FakeAdapter("codex", { defaultReply: "noted" });
    const room = new Room({ transcript: new TranscriptStore(), adapters: [claude, codex], roundBudget: 3 });
    const chat: [string, string][] = [];
    room.on((ev) => {
      if (ev.type === "message" && ev.message.kind === "chat") chat.push([ev.message.author, ev.message.content]);
    });
    await room.start(CTX);
    await room.sendUserMessage("@claude help");
    expect(chat).toEqual([
      ["user", "@claude help"],
      ["claude", "on it"],
    ]);
  });
});
