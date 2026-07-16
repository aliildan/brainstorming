import React from "react";
import { render } from "ink";
import { Room, TranscriptStore } from "@brainstorming/core";
import { App } from "@brainstorming/tui";
import { demoAdapters } from "./demo.js";
import { runLive } from "./run.js";

const args = process.argv.slice(2);

function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "brainstorming — multi-agent collaborative dev chat\n\n" +
        "Usage:\n" +
        "  brainstorming            Live chat with real agents in the current directory\n" +
        "  brainstorming --demo     Scripted demo, no AI quota used\n" +
        "  brainstorming --budget N Set the agent-to-agent round budget (demo)\n",
    );
    return;
  }

  if (args.includes("--demo")) {
    const budget = Number(argValue("--budget") ?? 3);
    const room = new Room({
      transcript: new TranscriptStore(),
      adapters: demoAdapters(),
      roundBudget: Number.isInteger(budget) && budget > 0 ? budget : 3,
    });
    await room.start({ workspaceDir: process.cwd(), persona: "" });
    render(React.createElement(App, { room, title: "brainstorming (demo)" }));
    return;
  }

  await runLive(process.cwd());
}

void main();
