/**
 * Live smoke test for AntigravityAdapter against the real `agy` binary.
 * Not part of `pnpm test` (it consumes real quota and needs an authenticated agy).
 *
 * Run:  node --import tsx packages/adapters/scripts/smoke-antigravity.ts
 * Env:  AGY_MODEL (default "Gemini 3.5 Flash (Low)"), AGY_BIN (default "agy")
 *
 * Proves: streaming, first-turn id capture, and stateful resume across turns
 * (plants a secret on turn 1, recalls it on turn 2 via --conversation).
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatMessage } from "@brainstorming/core";
import { AntigravityAdapter } from "../src/index.js";

const ws = join(homedir(), ".cache", "bs-agy-smoke");
mkdirSync(ws, { recursive: true });

const adapter = new AntigravityAdapter("antigravity", {
  model: process.env.AGY_MODEL ?? "Gemini 3.5 Flash (Low)",
});
await adapter.start({
  workspaceDir: ws,
  persona: "You are @antigravity, a terse assistant in a group chat. Reply in one short sentence.",
});

function input(content: string): { digest: ChatMessage[]; addressed: ChatMessage } {
  return {
    digest: [],
    addressed: { id: content, ts: Date.now(), author: "user", content, mentions: [], kind: "chat" },
  };
}

async function turn(label: string, content: string): Promise<string> {
  process.stdout.write(`\n[${label}] > ${content}\n  `);
  let acc = "";
  for await (const ev of adapter.prompt(input(content), new AbortController().signal)) {
    if (ev.type === "text-delta") {
      acc += ev.text;
      process.stdout.write(ev.text);
    } else if (ev.type === "activity") {
      process.stdout.write(`\n  (activity: ${ev.activity.title})\n  `);
    } else if (ev.type === "done") {
      process.stdout.write(`\n  [done] session=${adapter.sessionId}\n`);
    } else if (ev.type === "error") {
      process.stdout.write(`\n  [ERROR] ${ev.error.message}\n`);
    }
  }
  return acc;
}

await turn("turn1", "Remember this secret word: BANANA42. Acknowledge in one word.");
const recall = await turn("turn2", "What is the secret word I told you earlier?");

const ok = /BANANA42/i.test(recall);
console.log(`\n\nRESULT: stateful resume ${ok ? "PASS ✓" : "FAIL ✗"} — session=${adapter.sessionId}`);
process.exit(ok ? 0 : 1);
