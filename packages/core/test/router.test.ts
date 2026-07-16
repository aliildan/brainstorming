import { describe, expect, it } from "vitest";
import { resolveTargets } from "@brainstorming/core";

describe("resolveTargets", () => {
  it("uses mentions when present", () => {
    expect(resolveTargets({ mentions: ["codex"], sticky: ["claude"] })).toEqual(["codex"]);
  });

  it("falls back to sticky targets when no mentions", () => {
    expect(resolveTargets({ mentions: [], sticky: ["claude", "gemini"] })).toEqual([
      "claude",
      "gemini",
    ]);
  });

  it("returns empty when neither mentions nor sticky exist", () => {
    expect(resolveTargets({ mentions: [], sticky: [] })).toEqual([]);
  });
});
