import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  FakeAdapter,
  Room,
  TranscriptStore,
  type AgentEvent,
  type ChatMessage,
  type PromptInput,
} from "@brainstorming/core";
import { AntigravityAdapter, type AgyChild, type SpawnAgy } from "@brainstorming/adapters";

/** A scripted `agy` process: emits the given JSONL lines, then EOF (unless holdOpen). */
function fakeAgy(script: { lines: string[]; exitCode?: number; holdOpen?: boolean }) {
  const state = { killed: false, calls: [] as string[][] };
  const spawn: SpawnAgy = (args) => {
    state.calls.push(args);
    const emitter = new EventEmitter();
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    void (async () => {
      for (const line of script.lines) {
        await new Promise((r) => setImmediate(r));
        stdout.push(line + "\n");
      }
      if (!script.holdOpen) stdout.push(null);
    })();
    stdout.on("end", () => emitter.emit("close", script.exitCode ?? 0));
    const child: AgyChild = {
      stdout,
      stderr,
      on: (event, listener) => {
        emitter.on(event, listener as (...a: unknown[]) => void);
      },
      kill: () => {
        state.killed = true;
        stdout.push(null);
        emitter.emit("close", null);
      },
    };
    return child;
  };
  return { spawn, state };
}

function addressed(content: string): ChatMessage {
  return { id: "u1", ts: 1, author: "user", content, mentions: [], kind: "chat" };
}
const INPUT: PromptInput = { digest: [], addressed: addressed("which api style?") };
const CTX = { workspaceDir: "/tmp/ws", persona: "You are @antigravity in a group chat." };

async function drain(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of it) events.push(ev);
  return events;
}

const initLine = (id: string) => JSON.stringify({ event: "init", conversation_id: id, init: {} });
const deltaLine = (t: string) =>
  JSON.stringify({ event: "step_update", step_update: { step_type: "agent_response", text_delta: t, state: "DONE" } });
const resultLine = (id: string, response: string) =>
  JSON.stringify({ event: "result", result: { conversation_id: id, status: "SUCCESS", response } });

describe("AntigravityAdapter", () => {
  it("first turn: no --conversation, captures the server id, streams deltas + done", async () => {
    const { spawn, state } = fakeAgy({
      lines: [initLine("conv-1"), deltaLine("REST "), deltaLine("is fine."), resultLine("conv-1", "REST is fine.")],
    });
    const adapter = new AntigravityAdapter("antigravity", { spawn });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal));

    expect(state.calls[0]).not.toContain("--conversation");
    expect(state.calls[0]).toContain("--output-format");
    expect(state.calls[0]).toContain("stream-json");
    // The prompt is the VALUE of -p (kept last), never a bare trailing positional.
    const pIdx = state.calls[0].indexOf("-p");
    expect(pIdx).toBeGreaterThanOrEqual(0);
    expect(state.calls[0][pIdx + 1]).toBe(state.calls[0].at(-1));
    expect(events.filter((e) => e.type === "text-delta").map((e) => (e.type === "text-delta" ? e.text : ""))).toEqual([
      "REST ",
      "is fine.",
    ]);
    expect(events.at(-1)).toEqual({ type: "done", finalText: "REST is fine." });
    expect(adapter.sessionId).toBe("conv-1");
  });

  it("second turn resumes with --conversation <capturedId>", async () => {
    const { spawn, state } = fakeAgy({
      lines: [initLine("conv-1"), resultLine("conv-1", "hi")],
    });
    const adapter = new AntigravityAdapter("antigravity", { spawn });
    await adapter.start(CTX);
    await drain(adapter.prompt(INPUT, new AbortController().signal));
    await drain(adapter.prompt({ digest: [], addressed: addressed("follow up") }, new AbortController().signal));

    expect(state.calls[1]).toContain("--conversation");
    expect(state.calls[1][state.calls[1].indexOf("--conversation") + 1]).toBe("conv-1");
  });

  it("sends persona on the first turn only", async () => {
    const { spawn, state } = fakeAgy({ lines: [initLine("c"), resultLine("c", "ok")] });
    const adapter = new AntigravityAdapter("antigravity", { spawn });
    await adapter.start(CTX);
    await drain(adapter.prompt(INPUT, new AbortController().signal));
    await drain(adapter.prompt({ digest: [], addressed: addressed("again") }, new AbortController().signal));

    const firstPrompt = state.calls[0].at(-1)!;
    const secondPrompt = state.calls[1].at(-1)!;
    expect(firstPrompt.startsWith("You are @antigravity in a group chat.")).toBe(true);
    expect(secondPrompt).not.toContain("You are @antigravity");
  });

  it("maps a tool_call step to an activity event", async () => {
    const { spawn } = fakeAgy({
      lines: [
        initLine("c"),
        JSON.stringify({ event: "step_update", step_update: { step_type: "tool_call", tool_name: "run_command", state: "DONE" } }),
        resultLine("c", "done"),
      ],
    });
    const adapter = new AntigravityAdapter("antigravity", { spawn });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal));
    const activity = events.find((e) => e.type === "activity");
    expect(activity).toEqual({ type: "activity", activity: { kind: "tool", title: "run_command", status: "ok" } });
  });

  it("maps an ERROR result to an error event", async () => {
    const { spawn } = fakeAgy({
      lines: [JSON.stringify({ event: "result", result: { status: "ERROR", error: "invalid --model", conversation_id: "" } })],
      exitCode: 1,
    });
    const adapter = new AntigravityAdapter("antigravity", { spawn });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal));
    expect(events).toEqual([{ type: "error", error: { message: "invalid --model", fatal: false } }]);
  });

  it("emits an error when the process closes with no result", async () => {
    const { spawn } = fakeAgy({ lines: [initLine("c")], exitCode: 1 });
    const adapter = new AntigravityAdapter("antigravity", { spawn });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("error");
    expect(events[0].type === "error" && events[0].error.message).toContain("no result");
  });

  it("kills the process on abort and stops without done", async () => {
    const { spawn, state } = fakeAgy({ lines: [deltaLine("partial ")], holdOpen: true });
    const adapter = new AntigravityAdapter("antigravity", { spawn });
    await adapter.start(CTX);
    const ac = new AbortController();
    const events: AgentEvent[] = [];
    for await (const ev of adapter.prompt(INPUT, ac.signal)) {
      events.push(ev);
      if (ev.type === "text-delta") ac.abort();
    }
    expect(state.killed).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("plugs into the Room: a mentioned turn appends the agent reply", async () => {
    const { spawn } = fakeAgy({
      lines: [initLine("c"), deltaLine("On it. "), deltaLine("@claude thoughts?"), resultLine("c", "On it. @claude thoughts?")],
    });
    const antigravity = new AntigravityAdapter("antigravity", { spawn });
    const claude = new FakeAdapter("claude", { defaultReply: "looks good" });
    const room = new Room({ transcript: new TranscriptStore(), adapters: [antigravity, claude], roundBudget: 3 });
    const chat: [string, string][] = [];
    room.on((ev) => {
      if (ev.type === "message" && ev.message.kind === "chat") chat.push([ev.message.author, ev.message.content]);
    });
    await room.start(CTX);
    await room.sendUserMessage("@antigravity please help");
    // antigravity replies (mentioning claude), which pulls claude in for one cascade round
    expect(chat).toEqual([
      ["user", "@antigravity please help"],
      ["antigravity", "On it. @claude thoughts?"],
      ["claude", "looks good"],
    ]);
  });
});
