import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { render } from "ink";
import { buildPersona, Room, RoomStore, type RoomParticipant } from "@brainstorming/core";
import { App } from "@brainstorming/tui";
import { buildAgents } from "./agents.js";
import { configPath, loadConfig, type AgentName } from "./config.js";

function isGitRepo(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Wire the enabled real adapters into a room bound to `workspace`, then run the TUI. */
export async function runLive(workspace: string): Promise<void> {
  const config = loadConfig();
  const store = new RoomStore(workspace);
  const transcript = store.loadTranscript();
  const meta = store.loadMeta();
  const notes: string[] = [];

  let adapters = buildAgents(config, notes);
  if (!isGitRepo(workspace) && adapters.some((a) => a.name === "codex")) {
    adapters = adapters.filter((a) => a.name !== "codex");
    notes.push("codex disabled: workspace is not a git repository (run `git init` to enable it).");
  }
  if (adapters.length === 0) {
    console.error(`No agents available. Edit ${configPath()} to enable agents, then retry.`);
    process.exit(1);
  }

  const roundBudget = meta?.roundBudget ?? config.roundBudget;
  const room = new Room({ transcript, adapters, roundBudget });
  const resuming = transcript.length > 0;
  if (resuming) room.markAllSeen();

  const roster = adapters.map((a) => a.name);
  const savedSessions = new Map<string, string | undefined>(
    (meta?.participants ?? []).map((p) => [p.name, p.sessionId]),
  );
  const priorMessages = [...transcript.all()];

  await Promise.all(
    adapters.map((adapter) =>
      adapter.start({
        workspaceDir: workspace,
        persona: buildPersona({
          name: adapter.name,
          roster,
          extra: config.agents[adapter.name as AgentName]?.personaExtra,
        }),
        savedSessionId: savedSessions.get(adapter.name),
        transcript: priorMessages,
      }),
    ),
  );

  for (const note of notes) room.note(note);
  if (resuming) room.note(`resumed room with ${transcript.length} prior messages`);

  const decisionsPath = join(workspace, "DECISIONS.md");
  const onDecide = (text: string) => appendFileSync(decisionsPath, `- ${new Date().toISOString()} — ${text}\n`);

  const instance = render(
    React.createElement(App, { room, title: `brainstorming — ${workspace}`, onDecide }),
  );
  await instance.waitUntilExit();

  // Persist native session ids so the next run resumes each backend.
  const participants: RoomParticipant[] = [];
  for (const adapter of adapters) {
    const sessionId = await adapter.stop().catch(() => undefined);
    participants.push({ name: adapter.name, sessionId });
  }
  store.saveMeta({ participants, roundBudget });
}
