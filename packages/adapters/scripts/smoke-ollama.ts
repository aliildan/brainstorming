/**
 * Live smoke test for OllamaAdapter against a running `ollama serve`.
 * Not part of `pnpm test`. Run:
 *   node --import tsx packages/adapters/scripts/smoke-ollama.ts
 * Env: OLLAMA_MODEL (default "qwen3.5:cloud"), OLLAMA_HOST.
 *
 * Proves streaming + client-managed history continuity across turns.
 */
import type { ChatMessage } from "@brainstorming/core";
import { OllamaAdapter } from "../src/index.js";

const adapter = new OllamaAdapter("ollama", {
  model: process.env.OLLAMA_MODEL ?? "qwen3.5:cloud",
  host: process.env.OLLAMA_HOST,
});
await adapter.start({
  workspaceDir: process.cwd(),
  persona: "You are @ollama, a terse assistant in a group chat. Answer in one short sentence.",
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
    } else if (ev.type === "error") {
      process.stdout.write(`\n  [ERROR] ${ev.error.message}\n`);
    }
  }
  return acc;
}

await turn("turn1", "Remember the code word MANGO7. Reply with just: ok");
const recall = await turn("turn2", "What code word did I give you?");
const ok = /MANGO7/i.test(recall);
console.log(`\n\nRESULT: history continuity ${ok ? "PASS ✓" : "FAIL ✗"}`);
process.exit(ok ? 0 : 1);
