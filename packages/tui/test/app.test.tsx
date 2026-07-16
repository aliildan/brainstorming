import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { FakeAdapter, Room, TranscriptStore } from "@brainstorming/core";
import { App } from "@brainstorming/tui";

const CTX = { workspaceDir: "/tmp", persona: "" };
const flush = () => new Promise((r) => setTimeout(r, 30));

describe("App", () => {
  it("renders roster in status bar and finalized messages in transcript", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "hello human" });
    const room = new Room({ transcript: new TranscriptStore(), adapters: [claude] });
    await room.start(CTX);
    const { lastFrame } = render(<App room={room} />);
    await flush(); // let the useEffect subscribe before sending
    await room.sendUserMessage("@claude hi");
    await flush();
    const frame = lastFrame()!;
    expect(frame).toContain("claude"); // status bar
    expect(frame).toContain("[user]"); // finalized user message
    expect(frame).toContain("hello human"); // agent reply
  });
});
