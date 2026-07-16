import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPersona,
  FakeAdapter,
  Room,
  RoomStore,
  TranscriptStore,
  type ChatMessage,
} from "@brainstorming/core";

describe("buildPersona", () => {
  it("names the agent, lists the others, and appends extra guidance", () => {
    const p = buildPersona({ name: "codex", roster: ["claude", "codex", "ollama"], extra: "Prefer TypeScript." });
    expect(p).toContain("You are @codex");
    expect(p).toContain("@claude");
    expect(p).toContain("@ollama");
    expect(p).not.toMatch(/room:.*@codex/); // codex not listed among "others"
    expect(p).toContain("Prefer TypeScript.");
  });
});

describe("RoomStore", () => {
  it("round-trips meta and resolves paths under .brainstorming", () => {
    const ws = mkdtempSync(join(tmpdir(), "bs-ws-"));
    const store = new RoomStore(ws);
    expect(store.exists).toBe(false);
    expect(store.transcriptPath).toContain(".brainstorming");
    store.saveMeta({ participants: [{ name: "claude", sessionId: "s1" }], roundBudget: 3 });
    expect(store.exists).toBe(true);
    const meta = store.loadMeta()!;
    expect(meta.roundBudget).toBe(3);
    expect(meta.participants[0]).toEqual({ name: "claude", sessionId: "s1" });
  });
});

describe("Room.markAllSeen", () => {
  it("gives resumed agents only NEW messages as their digest", async () => {
    const transcript = new TranscriptStore();
    const seed: ChatMessage = { id: "old", ts: 1, author: "user", content: "old talk", mentions: [], kind: "chat" };
    transcript.append(seed);
    const codex = new FakeAdapter("codex", { defaultReply: "ok" });
    const room = new Room({ transcript, adapters: [codex], roundBudget: 3 });
    room.markAllSeen();
    await room.start({ workspaceDir: "/tmp", persona: "" });
    await room.sendUserMessage("@codex new question");
    // The pre-resume "old talk" must NOT appear in codex's digest.
    expect(codex.lastInput!.digest).toEqual([]);
    expect(codex.lastInput!.addressed.content).toBe("@codex new question");
  });
});
