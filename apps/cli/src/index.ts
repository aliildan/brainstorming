import React from "react";
import { render } from "ink";
import { Room, TranscriptStore } from "@brainstorming/core";
import { App } from "@brainstorming/tui";
import { demoAdapters } from "./demo.js";

const args = process.argv.slice(2);

function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (!args.includes("--demo")) {
    console.error(
      "Usage: brainstorming --demo [--budget N]\n" +
        "Only demo mode is available at this stage; real agent adapters arrive in later phases.",
    );
    process.exit(1);
  }
  const budget = Number(argValue("--budget") ?? 3);
  const room = new Room({
    transcript: new TranscriptStore(),
    adapters: demoAdapters(),
    roundBudget: Number.isInteger(budget) && budget > 0 ? budget : 3,
  });
  await room.start({ workspaceDir: process.cwd(), persona: "" });
  render(React.createElement(App, { room, title: "brainstorming (demo)" }));
}

void main();
