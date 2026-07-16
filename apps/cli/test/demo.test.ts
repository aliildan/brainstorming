import { describe, expect, it } from "vitest";
import { Room, TranscriptStore, type RoomEvent } from "@brainstorming/core";
import { demoAdapters } from "../src/demo.js";

const CTX = { workspaceDir: "/tmp", persona: "" };

function makeRoom(roundBudget = 3) {
  const room = new Room({
    transcript: new TranscriptStore(),
    adapters: demoAdapters(),
    roundBudget,
  });
  const chat: [string, string][] = [];
  const events: RoomEvent[] = [];
  room.on((ev) => {
    events.push(ev);
    if (ev.type === "message" && ev.message.kind === "chat") {
      chat.push([ev.message.author, ev.message.content]);
    }
  });
  return { room, chat, events };
}

describe("demo end-to-end (headless Room with the real demo roster)", () => {
  it("@all gathers four opinions and claude consults codex", async () => {
    const { room, chat } = makeRoom();
    await room.start(CTX);
    await room.sendUserMessage("@all which api style should we use?");

    const authors = chat.map((c) => c[0]);
    const contents = chat.map((c) => c[1]);
    // All four agents respond to the broadcast (excluding the user's own message).
    const agentAuthors = new Set(authors.filter((a) => a !== "user"));
    expect(agentAuthors).toEqual(new Set(["claude", "codex", "antigravity", "ollama"]));
    expect(contents).toContain("I lean REST here — simpler caching. @codex do you agree?");
    expect(contents).toContain("Alternative view: consider the long-term client list before deciding.");
    // The consultation reply arrives after claude's question (one cascade round).
    const agreedAt = contents.indexOf("Agreed — versioned REST plus OpenAPI. I can scaffold it.");
    const askedAt = contents.indexOf("I lean REST here — simpler caching. @codex do you agree?");
    expect(agreedAt).toBeGreaterThan(askedAt);
  });

  it("pingpong stops at the round budget with a /continue note", async () => {
    const { room, chat, events } = makeRoom(2);
    await room.start(CTX);
    await room.sendUserMessage("@claude pingpong");
    const chatAuthors = chat.map((c) => c[0]);
    expect(chatAuthors).toEqual(["user", "claude", "codex", "claude"]);
    expect(room.pendingMentions.length).toBeGreaterThan(0);
    const note = events.find(
      (e) => e.type === "message" && e.message.kind === "system" && e.message.content.includes("/continue"),
    );
    expect(note).toBeTruthy();
  });

  it("codex asks permission; deny skips the activity", async () => {
    const { room, chat, events } = makeRoom();
    room.on((ev) => {
      if (ev.type === "permission") ev.respond("deny");
    });
    await room.start(CTX);
    await room.sendUserMessage("@codex run the tests");
    const contents = chat.map((c) => c[1]);
    expect(contents).toContain("Okay, skipping the test run.");
    expect(events.some((e) => e.type === "message" && e.message.kind === "activity")).toBe(false);
  });

  it("codex asks permission; allow runs the activity", async () => {
    const { room, chat, events } = makeRoom();
    room.on((ev) => {
      if (ev.type === "permission") ev.respond("allow-once");
    });
    await room.start(CTX);
    await room.sendUserMessage("@codex run the tests");
    const contents = chat.map((c) => c[1]);
    expect(contents).toContain("Ran the tests — all green.");
    const activity = events.find((e) => e.type === "message" && e.message.kind === "activity");
    expect(activity && activity.type === "message" && activity.message.content).toContain(
      "ran: pnpm test (12 passed)",
    );
  });
});
