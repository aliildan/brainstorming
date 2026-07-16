import { describe, expect, it } from "vitest";
import { parseMentions } from "@brainstorming/core";

const ROSTER = ["claude", "codex", "gemini", "ollama"];

describe("parseMentions", () => {
  it("finds roster mentions in first-mention order, deduped", () => {
    expect(parseMentions("@codex then @claude then @codex again", ROSTER)).toEqual([
      "codex",
      "claude",
    ]);
  });

  it("is case-insensitive and ignores unknown names", () => {
    expect(parseMentions("@Claude @nobody @GEMINI", ROSTER)).toEqual(["claude", "gemini"]);
  });

  it("expands @all to the whole roster in roster order", () => {
    expect(parseMentions("@all thoughts?", ROSTER)).toEqual(ROSTER);
  });

  it("returns empty array when no mentions", () => {
    expect(parseMentions("no mentions here", ROSTER)).toEqual([]);
  });

  it("matches names containing dots, dashes, colons", () => {
    expect(parseMentions("@ollama:qwen hi", ["ollama:qwen"])).toEqual(["ollama:qwen"]);
  });
});
