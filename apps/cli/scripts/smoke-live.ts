/**
 * Headless live smoke for the CLI wiring: config -> buildAgents -> Room ->
 * RoomStore persistence/resume, driving a real adapter (Ollama, cheapest).
 * Not part of `pnpm test`.
 *   node --import tsx apps/cli/scripts/smoke-live.ts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPersona, Room, RoomStore } from "@brainstorming/core";
import { buildAgents } from "../src/agents.js";
import type { Config } from "../src/config.js";

const config: Config = {
  roundBudget: 3,
  agents: {
    claude: { enabled: false },
    codex: { enabled: false },
    antigravity: { enabled: false },
    ollama: { enabled: true, model: process.env.OLLAMA_MODEL },
  },
};

const notes: string[] = [];
const adapters = buildAgents(config, notes);
if (notes.length) console.log("notes:", notes);
if (adapters.length === 0) {
  console.error("no adapters built");
  process.exit(1);
}

const ws = mkdtempSync(join(tmpdir(), "bs-live-"));
const store = new RoomStore(ws);
const roster = adapters.map((a) => a.name);

const room = new Room({ transcript: store.loadTranscript(), adapters, roundBudget: 3 });
room.on((ev) => {
  if (ev.type === "message" && ev.message.kind === "chat") console.log(`  [${ev.message.author}] ${ev.message.content}`);
});

await Promise.all(
  adapters.map((a) => a.start({ workspaceDir: ws, persona: buildPersona({ name: a.name, roster }) })),
);

console.log("> @ollama say hello to the team in a short sentence");
await room.sendUserMessage("@ollama say hello to the team in a short sentence");

// Persist and prove the transcript survives a reload (resume path).
const participants = [];
for (const a of adapters) participants.push({ name: a.name, sessionId: await a.stop().catch(() => undefined) });
store.saveMeta({ participants, roundBudget: 3 });

const reloaded = new RoomStore(ws);
const persisted = reloaded.loadTranscript().all();
const ok = persisted.some((m) => m.author === "ollama") && reloaded.loadMeta() !== null;
console.log(`\nRESULT: live wiring + persistence ${ok ? "PASS ✓" : "FAIL ✗"} (${persisted.length} messages saved to ${ws})`);
process.exit(ok ? 0 : 1);
