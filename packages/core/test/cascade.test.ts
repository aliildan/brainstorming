import { describe, expect, it } from "vitest";
import { FakeAdapter, Room, TranscriptStore, type RoomEvent } from "@brainstorming/core";

const CTX = { workspaceDir: "/tmp", persona: "" };

function pingPongRoom(roundBudget: number) {
  const claude = new FakeAdapter("claude", {
    replies: [{ match: /ping|pong/i, reply: "@codex pong" }],
  });
  const codex = new FakeAdapter("codex", {
    replies: [{ match: /ping|pong/i, reply: "@claude ping" }],
  });
  const room = new Room({ transcript: new TranscriptStore(), adapters: [claude, codex], roundBudget });
  const events: RoomEvent[] = [];
  room.on((ev) => events.push(ev));
  return { room, events };
}

describe("cascade engine", () => {
  it("one consult round: reply mentioning another agent triggers exactly one delivery", async () => {
    const claude = new FakeAdapter("claude", {
      replies: [{ match: /api/i, reply: "REST. @codex agree?" }],
    });
    const codex = new FakeAdapter("codex", {
      replies: [{ match: /agree/i, reply: "Agreed." }],
      defaultReply: "hm",
    });
    const room = new Room({
      transcript: new TranscriptStore(),
      adapters: [claude, codex],
      roundBudget: 3,
    });
    const events: RoomEvent[] = [];
    room.on((ev) => events.push(ev));
    await room.start(CTX);
    await room.sendUserMessage("@claude which api style?");
    const chat = events.flatMap((e) =>
      e.type === "message" ? [[e.message.author, e.message.content]] : [],
    );
    expect(chat).toEqual([
      ["user", "@claude which api style?"],
      ["claude", "REST. @codex agree?"],
      ["codex", "Agreed."],
    ]);
    expect(room.pendingMentions).toEqual([]);
  });

  it("stops at the round budget, stores pending, emits budget-exhausted", async () => {
    const { room, events } = pingPongRoom(2);
    await room.start(CTX);
    await room.sendUserMessage("@claude ping");
    const chatAuthors = events.flatMap((e) =>
      e.type === "message" && e.message.kind === "chat" ? [e.message.author] : [],
    );
    expect(chatAuthors).toEqual(["user", "claude", "codex", "claude"]);
    expect(room.pendingMentions.map((p) => [p.from, p.to])).toEqual([["claude", "codex"]]);
    expect(events.some((e) => e.type === "budget-exhausted")).toBe(true);
    const note = events.find((e) => e.type === "message" && e.message.kind === "system");
    expect(note && note.type === "message" && note.message.content).toContain("/continue");
  });

  it("continueCascade resumes with a fresh budget", async () => {
    const { room, events } = pingPongRoom(1);
    await room.start(CTX);
    await room.sendUserMessage("@claude ping");
    const before = events.filter((e) => e.type === "message" && e.message.kind === "chat").length;
    await room.continueCascade();
    const after = events.filter((e) => e.type === "message" && e.message.kind === "chat").length;
    expect(after).toBeGreaterThan(before);
    expect(room.pendingMentions.length).toBeGreaterThan(0);
  });

  it("interrupt aborts mid-stream and appends an interrupted note", async () => {
    const claude = new FakeAdapter("claude", {
      defaultReply: "a very long answer indeed",
      chunkDelayMs: 10,
    });
    const room = new Room({ transcript: new TranscriptStore(), adapters: [claude], roundBudget: 3 });
    const events: RoomEvent[] = [];
    room.on((ev) => {
      events.push(ev);
      if (ev.type === "stream-delta") room.interrupt();
    });
    await room.start(CTX);
    await room.sendUserMessage("@claude go");
    expect(
      events.some(
        (e) =>
          e.type === "message" && e.message.kind === "system" && /interrupted/.test(e.message.content),
      ),
    ).toBe(true);
  });
});
