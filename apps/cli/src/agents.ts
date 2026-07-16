import { execFileSync } from "node:child_process";
import type { AgentAdapter } from "@brainstorming/core";
import { AntigravityAdapter, ClaudeAdapter, CodexAdapter, OllamaAdapter } from "@brainstorming/adapters";
import type { Config } from "./config.js";

/** Pick an Ollama model when none is configured: prefer a `*-cloud` model, else a non-embedding local one. */
export function detectOllamaModel(): string | undefined {
  try {
    const out = execFileSync("ollama", ["list"], { encoding: "utf8" });
    const names = out
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.split(/\s+/)[0])
      .filter(Boolean);
    return names.find((m) => m.includes(":cloud")) ?? names.find((m) => !m.includes("embed")) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Construct the enabled agent adapters. Appends human-readable notes for anything skipped. */
export function buildAgents(config: Config, notes: string[]): AgentAdapter[] {
  const adapters: AgentAdapter[] = [];
  const a = config.agents;

  if (a.claude.enabled) adapters.push(new ClaudeAdapter("claude"));
  if (a.codex.enabled) adapters.push(new CodexAdapter("codex", { model: a.codex.model }));
  if (a.antigravity.enabled) adapters.push(new AntigravityAdapter("antigravity", { model: a.antigravity.model }));
  if (a.ollama.enabled) {
    const model = a.ollama.model ?? detectOllamaModel();
    if (model) adapters.push(new OllamaAdapter("ollama", { model }));
    else notes.push("ollama disabled: no model configured and none detected (set agents.ollama.model in config).");
  }
  return adapters;
}
