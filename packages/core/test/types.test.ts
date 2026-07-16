import { describe, expect, it } from "vitest";
import type { AgentEvent, ChatMessage } from "@brainstorming/core";

describe("core types", () => {
  it("constructs a ChatMessage and an AgentEvent", () => {
    const msg: ChatMessage = {
      id: "m1",
      ts: 0,
      author: "user",
      content: "hello @claude",
      mentions: ["claude"],
      kind: "chat",
    };
    const ev: AgentEvent = { type: "text-delta", text: "hi" };
    expect(msg.mentions).toEqual(["claude"]);
    expect(ev.type).toBe("text-delta");
  });
});
