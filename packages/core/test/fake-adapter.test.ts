import { describe, expect, it } from "vitest";
import {
  FakeAdapter,
  type AgentEvent,
  type ChatMessage,
  type PermissionDecision,
} from "@brainstorming/core";

function addressed(content: string): ChatMessage {
  return { id: "x", ts: 1, author: "user", content, mentions: [], kind: "chat" };
}

async function collect(
  adapter: FakeAdapter,
  content: string,
  decide?: PermissionDecision,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const ac = new AbortController();
  for await (const ev of adapter.prompt({ digest: [], addressed: addressed(content) }, ac.signal)) {
    events.push(ev);
    if (ev.type === "permission-request" && decide) ev.respond(decide);
  }
  return events;
}

describe("FakeAdapter", () => {
  it("streams deltas and ends with done matching the scripted reply", async () => {
    const fake = new FakeAdapter("claude", {
      replies: [{ match: /api/i, reply: "REST is fine." }],
      defaultReply: "hm",
    });
    const events = await collect(fake, "which API style?");
    const deltas = events.filter((e) => e.type === "text-delta");
    const done = events.at(-1);
    expect(deltas.length).toBeGreaterThan(1);
    expect(done).toEqual({ type: "done", finalText: "REST is fine." });
    expect(fake.lastInput?.addressed.content).toBe("which API style?");
  });

  it("uses defaultReply when nothing matches", async () => {
    const fake = new FakeAdapter("gemini", { defaultReply: "no opinion" });
    const events = await collect(fake, "anything");
    expect(events.at(-1)).toEqual({ type: "done", finalText: "no opinion" });
  });

  it("pauses on permission and continues on allow with activity", async () => {
    const fake = new FakeAdapter("codex", {
      replies: [
        {
          match: /tests/,
          reply: "All green.",
          permission: { action: "run command", preview: "pnpm test" },
          activity: { kind: "command", title: "ran: pnpm test", status: "ok" },
        },
      ],
    });
    const events = await collect(fake, "run the tests", "allow-once");
    expect(events[0].type).toBe("permission-request");
    expect(events.some((e) => e.type === "activity")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", finalText: "All green." });
  });

  it("replies with denyReply on deny and skips the activity", async () => {
    const fake = new FakeAdapter("codex", {
      replies: [
        {
          match: /tests/,
          reply: "All green.",
          permission: { action: "run command", preview: "pnpm test", denyReply: "Skipped." },
          activity: { kind: "command", title: "ran: pnpm test", status: "ok" },
        },
      ],
    });
    const events = await collect(fake, "run the tests", "deny");
    expect(events.some((e) => e.type === "activity")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done", finalText: "Skipped." });
  });

  it("yields an error event when scripted", async () => {
    const fake = new FakeAdapter("claude", { replies: [{ match: /boom/, reply: "", error: "kaput" }] });
    const events = await collect(fake, "boom");
    expect(events).toEqual([{ type: "error", error: { message: "kaput", fatal: false } }]);
  });

  it("stops without done when aborted", async () => {
    const fake = new FakeAdapter("claude", { defaultReply: "one two three four", chunkDelayMs: 5 });
    const ac = new AbortController();
    const events: AgentEvent[] = [];
    for await (const ev of fake.prompt({ digest: [], addressed: addressed("go") }, ac.signal)) {
      events.push(ev);
      ac.abort();
    }
    expect(events.some((e) => e.type === "done")).toBe(false);
  });
});
