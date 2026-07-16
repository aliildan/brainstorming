import { describe, expect, it } from "vitest";
import { FakeAdapter, Room, TranscriptStore, type RoomEvent } from "@brainstorming/core";

const CTX = { workspaceDir: "/tmp", persona: "" };

function makeRoom(adapters: FakeAdapter[], roundBudget = 3) {
  const room = new Room({ transcript: new TranscriptStore(), adapters, roundBudget });
  const events: RoomEvent[] = [];
  room.on((ev) => events.push(ev));
  return { room, events };
}

describe("Room user wave", () => {
  it("returns needs-target when there is no mention and no sticky", async () => {
    const { room } = makeRoom([new FakeAdapter("claude")]);
    await room.start(CTX);
    const res = await room.sendUserMessage("hello there");
    expect(res).toEqual({ status: "needs-target" });
    expect(room.roster).toEqual(["claude"]);
  });

  it("delivers to the mentioned agent and appends its reply", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "hi!" });
    const { room, events } = makeRoom([claude]);
    await room.start(CTX);
    const res = await room.sendUserMessage("@claude hello");
    expect(res).toEqual({ status: "sent" });
    const chat = events.flatMap((e) => (e.type === "message" ? [e.message] : []));
    expect(chat.map((m) => [m.author, m.content])).toEqual([
      ["user", "@claude hello"],
      ["claude", "hi!"],
    ]);
  });

  it("sticky: un-mentioned follow-up goes to the previous targets", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "yes" });
    const codex = new FakeAdapter("codex", { defaultReply: "nope" });
    const { room, events } = makeRoom([claude, codex]);
    await room.start(CTX);
    await room.sendUserMessage("@claude first");
    await room.sendUserMessage("and again");
    const authors = events.flatMap((e) => (e.type === "message" ? [e.message.author] : []));
    expect(authors).toEqual(["user", "claude", "user", "claude"]);
    expect(room.stickyTargets).toEqual(["claude"]);
  });

  it("@all prompts every agent and digest carries missed messages", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "opinion A" });
    const codex = new FakeAdapter("codex", { defaultReply: "opinion B" });
    const { room } = makeRoom([claude, codex]);
    await room.start(CTX);
    await room.sendUserMessage("@claude warmup");
    await room.sendUserMessage("@all thoughts?");
    const digestAuthors = codex.lastInput!.digest.map((m) => m.author);
    expect(digestAuthors).toEqual(["user", "claude"]);
    expect(codex.lastInput!.addressed.content).toBe("@all thoughts?");
  });

  it("adapter error appends a system note and other agents still reply", async () => {
    const claude = new FakeAdapter("claude", {
      replies: [{ match: /.*/, reply: "", error: "kaput" }],
    });
    const codex = new FakeAdapter("codex", { defaultReply: "still here" });
    const { room, events } = makeRoom([claude, codex]);
    await room.start(CTX);
    await room.sendUserMessage("@all go");
    const msgs = events.flatMap((e) => (e.type === "message" ? [e.message] : []));
    expect(msgs.some((m) => m.kind === "system" && m.content.includes("claude"))).toBe(true);
    expect(msgs.some((m) => m.author === "codex" && m.content === "still here")).toBe(true);
    expect(events.some((e) => e.type === "agent-error" && e.agent === "claude")).toBe(true);
  });

  it("emits thinking→idle status around a delivery", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "ok" });
    const { room, events } = makeRoom([claude]);
    await room.start(CTX);
    await room.sendUserMessage("@claude hello");
    const statuses = events.flatMap((e) =>
      e.type === "agent-status" && e.agent === "claude" ? [e.status] : [],
    );
    expect(statuses).toEqual(["thinking", "idle"]);
  });
});
