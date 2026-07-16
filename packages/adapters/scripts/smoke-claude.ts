/**
 * Live smoke test for ClaudeAdapter against the real Claude Agent SDK.
 * Not part of `pnpm test`. Uses the `claude` subscription login (unset
 * ANTHROPIC_API_KEY to avoid per-token billing).
 *   node --import tsx packages/adapters/scripts/smoke-claude.ts
 *
 * Proves streaming + session capture + resume across turns.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatMessage } from "@brainstorming/core";
import { ClaudeAdapter } from "../src/index.js";

const ws = join(homedir(), ".cache", "bs-claude-smoke");
mkdirSync(ws, { recursive: true });

const adapter = new ClaudeAdapter("claude", { permissionMode: "default" });
await adapter.start({
  workspaceDir: ws,
  persona: "You are @claude, terse, in a group chat. Answer in one short sentence and use no tools.",
});

function input(content: string): { digest: ChatMessage[]; addressed: ChatMessage } {
  return { digest: [], addressed: { id: content, ts: Date.now(), author: "user", content, mentions: [], kind: "chat" } };
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

await turn("turn1", "Remember the passphrase PINEAPPLE9. Acknowledge in one word.");
const recall = await turn("turn2", "What passphrase did I ask you to remember?");
const ok = /PINEAPPLE9/i.test(recall);
console.log(`\n\nRESULT: session resume ${ok ? "PASS ✓" : "FAIL ✗"} — session=${adapter.sessionId}`);
process.exit(ok ? 0 : 1);
