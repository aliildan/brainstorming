import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const AgentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Exact model string for the backend; omit to use its default (or auto-detect for Ollama). */
  model: z.string().optional(),
  /** Extra persona guidance appended to the group-chat protocol. */
  personaExtra: z.string().optional(),
});

export const ConfigSchema = z.object({
  roundBudget: z.number().int().positive().default(3),
  agents: z
    .object({
      claude: AgentConfigSchema.default({ enabled: true }),
      codex: AgentConfigSchema.default({ enabled: true }),
      antigravity: AgentConfigSchema.default({ enabled: true }),
      ollama: AgentConfigSchema.default({ enabled: true }),
    })
    .default({
      claude: { enabled: true },
      codex: { enabled: true },
      antigravity: { enabled: true },
      ollama: { enabled: true },
    }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentName = keyof Config["agents"];

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "brainstorming", "config.json");
}

/** Load global config, creating a default file on first run. Invalid files fall back to defaults. */
export function loadConfig(): Config {
  const path = configPath();
  if (existsSync(path)) {
    try {
      return ConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      // fall through and rewrite defaults
    }
  }
  const defaults = ConfigSchema.parse({});
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(defaults, null, 2) + "\n");
  return defaults;
}
