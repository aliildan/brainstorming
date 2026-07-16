/**
 * Live smoke test for CodexAdapter against a real `codex app-server`.
 * Not part of `pnpm test`. Needs `codex login` and a git-repo workspace.
 *   node --import tsx packages/adapters/scripts/smoke-codex.ts
 *
 * Proves the JSON-RPC handshake, streaming, and turn continuity.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { ChatMessage } from "@brainstorming/core";
import { CodexAdapter } from "../src/index.js";

const ws = join(homedir(), ".cache", "bs-codex-smoke");
mkdirSync(ws, { recursive: true });
try {
  execFileSync("git", ["-C", ws, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
} catch {
  execFileSync("git", ["init", "-q", ws]);
}

const adapter = new CodexAdapter("codex", { approvalPolicy: "never", sandbox: "read-only" });
await adapter.start({
  workspaceDir: ws,
  persona: "You are @codex, terse, in a group chat. Answer in one short sentence; do not use tools.",
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
      process.stdout.write(`\n  [done] thread=${adapter.sessionId}\n`);
    } else if (ev.type === "error") {
      process.stdout.write(`\n  [ERROR] ${ev.error.message}\n`);
    }
  }
  return acc;
}

await turn("turn1", "Remember the fruit WATERMELON3. Reply with just: ok");
const recall = await turn("turn2", "What fruit did I ask you to remember?");
await adapter.stop();
const ok = /WATERMELON3/i.test(recall);
console.log(`\n\nRESULT: turn continuity ${ok ? "PASS ✓" : "FAIL ✗"} — thread=${adapter.sessionId}`);
process.exit(ok ? 0 : 1);
