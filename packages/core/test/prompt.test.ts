import { describe, expect, it } from "vitest";
import { renderPrompt, type ChatMessage } from "@brainstorming/core";

function msg(author: string, content: string): ChatMessage {
  return { id: author + content, ts: 1, author, content, mentions: [], kind: "chat" };
}

describe("renderPrompt", () => {
  it("renders digest section plus addressed message with [author] attribution", () => {
    const text = renderPrompt({
      digest: [msg("user", "hi everyone"), msg("claude", "hello!")],
      addressed: msg("user", "@codex your turn"),
    });
    expect(text).toBe(
      [
        "[Chat since your last turn]",
        "[user]: hi everyone",
        "[claude]: hello!",
        "---",
        "[You are addressed]",
        "[user]: @codex your turn",
      ].join("\n"),
    );
  });

  it("omits the digest section when empty", () => {
    const text = renderPrompt({ digest: [], addressed: msg("user", "hello") });
    expect(text).toBe(["[You are addressed]", "[user]: hello"].join("\n"));
  });
});
