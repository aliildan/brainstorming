import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TranscriptStore, type ChatMessage } from "@brainstorming/core";

function msg(id: string, content: string): ChatMessage {
  return { id, ts: 1, author: "user", content, mentions: [], kind: "chat" };
}

describe("TranscriptStore", () => {
  it("appends and reads back in order (memory)", () => {
    const t = new TranscriptStore();
    t.append(msg("a", "one"));
    t.append(msg("b", "two"));
    expect(t.length).toBe(2);
    expect(t.all().map((m) => m.content)).toEqual(["one", "two"]);
  });

  it("persists to a JSONL file and loads back", () => {
    const file = join(mkdtempSync(join(tmpdir(), "bs-")), "room.jsonl");
    const t = new TranscriptStore(file);
    t.append(msg("a", "hello"));
    t.append(msg("b", "world"));
    const loaded = TranscriptStore.load(file);
    expect(loaded.length).toBe(2);
    expect(loaded.all()[1].content).toBe("world");
  });

  it("load tolerates a missing file (starts empty)", () => {
    const file = join(mkdtempSync(join(tmpdir(), "bs-")), "missing.jsonl");
    const t = TranscriptStore.load(file);
    expect(t.length).toBe(0);
  });
});
