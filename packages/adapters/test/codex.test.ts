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
import { CodexAdapter, type CodexConnect } from "@brainstorming/adapters";

type Json = Record<string, unknown>;

interface Script {
  threadId?: string;
  deltas?: string[];
  finalText?: string;
  approval?: "command" | "file";
  command?: boolean;
  error?: string;
}

function fakeCodex(script: Script) {
  const state = {
    sent: [] as Json[],
    closed: false,
    threadId: script.threadId ?? "thr-1",
    approvalDecision: undefined as string | undefined,
  };
  let cb: ((m: Json) => void) | null = null;
  const emit = (m: Json) => queueMicrotask(() => cb?.(m)); // async, like real stdio

  function finishTurn() {
    if (script.command)
      emit({
        jsonrpc: "2.0",
        method: "item/completed",
        params: { item: { type: "commandExecution", command: "pnpm test", exitCode: 0 } },
      });
    for (const d of script.deltas ?? []) emit({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { delta: d } });
    emit({
      jsonrpc: "2.0",
      method: "item/completed",
      params: { item: { type: "agentMessage", text: script.finalText ?? (script.deltas ?? []).join("") } },
    });
    emit({ jsonrpc: "2.0", method: "turn/completed", params: {} });
  }

  const connect: CodexConnect = () => ({
    send: (msg) => {
      state.sent.push(msg);
      const id = msg.id as number | undefined;
      const method = msg.method as string | undefined;
      if (method === "initialize") emit({ jsonrpc: "2.0", id, result: { userAgent: "fake" } });
      else if (method === "thread/start") emit({ jsonrpc: "2.0", id, result: { thread: { id: state.threadId } } });
      else if (method === "thread/resume") emit({ jsonrpc: "2.0", id, result: {} });
      else if (method === "turn/interrupt") emit({ jsonrpc: "2.0", id, result: {} });
      else if (method === "turn/start") {
        emit({ jsonrpc: "2.0", id, result: { turn: { id: "turn-1" } } });
        if (script.error) {
          emit({ jsonrpc: "2.0", method: "error", params: { message: script.error } });
        } else if (script.approval) {
          const params = script.approval === "command" ? { command: "pnpm test" } : { changes: [{ path: "a.ts" }] };
          const method2 =
            script.approval === "command"
              ? "item/commandExecution/requestApproval"
              : "item/fileChange/requestApproval";
          emit({ jsonrpc: "2.0", id: 9999, method: method2, params });
        } else {
          finishTurn();
        }
      } else if (id !== undefined && msg.result !== undefined && !method) {
        // client answered our server-side approval request
        state.approvalDecision = (msg.result as Json).decision as string;
        finishTurn();
      }
    },
    onMessage: (fn) => {
      cb = fn;
    },
    close: () => {
      state.closed = true;
    },
  });
  return { connect, state };
}

function addressed(content: string): ChatMessage {
  return { id: content, ts: 1, author: "user", content, mentions: [], kind: "chat" };
}
const INPUT: PromptInput = { digest: [], addressed: addressed("build it") };
const CTX = { workspaceDir: "/tmp/ws", persona: "You are @codex." };

async function drain(it: AsyncIterable<AgentEvent>, decide?: PermissionDecision): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of it) {
    events.push(ev);
    if (ev.type === "permission-request" && decide) ev.respond(decide);
  }
  return events;
}

function sentMethods(sent: Json[]): string[] {
  return sent.map((m) => (m.method as string) ?? "(response)");
}

describe("CodexAdapter", () => {
  it("handshakes, starts a thread with persona, streams a turn", async () => {
    const { connect, state } = fakeCodex({ deltas: ["build", "ing"], finalText: "building" });
    const adapter = new CodexAdapter("codex", { connect });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal));

    expect(sentMethods(state.sent)).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
    const threadStart = state.sent.find((m) => m.method === "thread/start")!;
    expect((threadStart.params as Json).developerInstructions).toBe("You are @codex.");
    const turnStart = state.sent.find((m) => m.method === "turn/start")!;
    expect((turnStart.params as Json).threadId).toBe("thr-1");
    expect(events.filter((e) => e.type === "text-delta").length).toBe(2);
    expect(events.at(-1)).toEqual({ type: "done", finalText: "building" });
    expect(adapter.sessionId).toBe("thr-1");
  });

  it("resumes an existing thread instead of starting one", async () => {
    const { connect, state } = fakeCodex({ finalText: "ok" });
    const adapter = new CodexAdapter("codex", { connect });
    await adapter.start({ ...CTX, savedSessionId: "thr-99" });
    expect(sentMethods(state.sent)).toContain("thread/resume");
    expect(sentMethods(state.sent)).not.toContain("thread/start");
  });

  it("routes a command approval to the card; allow maps to accept", async () => {
    const { connect, state } = fakeCodex({ approval: "command", finalText: "ran it" });
    const adapter = new CodexAdapter("codex", { connect });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal), "allow-once");
    const req = events.find((e) => e.type === "permission-request");
    expect(req && req.type === "permission-request" && req.request.action).toBe("run command");
    expect(state.approvalDecision).toBe("accept");
    expect(events.at(-1)).toEqual({ type: "done", finalText: "ran it" });
  });

  it("maps deny to decline for a file-change approval", async () => {
    const { connect, state } = fakeCodex({ approval: "file", finalText: "skipped" });
    const adapter = new CodexAdapter("codex", { connect });
    await adapter.start(CTX);
    await drain(adapter.prompt(INPUT, new AbortController().signal), "deny");
    expect(state.approvalDecision).toBe("decline");
  });

  it("surfaces a commandExecution item as an activity", async () => {
    const { connect } = fakeCodex({ command: true, finalText: "done" });
    const adapter = new CodexAdapter("codex", { connect });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal));
    expect(events).toContainEqual({
      type: "activity",
      activity: { kind: "command", title: "ran: pnpm test", status: "ok" },
    });
  });

  it("maps an error notification to an error event", async () => {
    const { connect } = fakeCodex({ error: "context window exceeded" });
    const adapter = new CodexAdapter("codex", { connect });
    await adapter.start(CTX);
    const events = await drain(adapter.prompt(INPUT, new AbortController().signal));
    expect(events).toEqual([{ type: "error", error: { message: "context window exceeded", fatal: false } }]);
  });

  it("plugs into the Room", async () => {
    const { connect } = fakeCodex({ finalText: "on it" });
    const codex = new CodexAdapter("codex", { connect });
    const claude = new FakeAdapter("claude", { defaultReply: "ok" });
    const room = new Room({ transcript: new TranscriptStore(), adapters: [codex, claude], roundBudget: 3 });
    const chat: [string, string][] = [];
    room.on((ev) => {
      if (ev.type === "message" && ev.message.kind === "chat") chat.push([ev.message.author, ev.message.content]);
    });
    await room.start(CTX);
    await room.sendUserMessage("@codex help");
    expect(chat).toEqual([
      ["user", "@codex help"],
      ["codex", "on it"],
    ]);
  });
});
