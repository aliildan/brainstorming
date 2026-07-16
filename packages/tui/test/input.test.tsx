import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { FakeAdapter, Room, TranscriptStore } from "@brainstorming/core";
import { App, suggestions } from "@brainstorming/tui";

const CTX = { workspaceDir: "/tmp", persona: "" };
const flush = () => new Promise((r) => setTimeout(r, 40));

describe("input", () => {
  it("suggests roster completions for an @ token", () => {
    expect(suggestions("hey @c", ["claude", "codex"])).toEqual(["claude", "codex"]);
    expect(suggestions("hey @cl", ["claude", "codex"])).toEqual(["claude"]);
    expect(suggestions("plain text", ["claude"])).toEqual([]);
  });

  it("typed message reaches the room; needs-target notice appears without a mention", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "yo" });
    const room = new Room({ transcript: new TranscriptStore(), adapters: [claude] });
    await room.start(CTX);
    const { stdin, lastFrame } = render(<App room={room} />);
    await flush(); // let useEffect subscribe and input become active
    stdin.write("hello");
    stdin.write("\r");
    await flush();
    expect(lastFrame()!).toContain("No target");
    stdin.write("@claude hi");
    stdin.write("\r");
    await flush();
    expect(lastFrame()!).toContain("yo");
  });
});
