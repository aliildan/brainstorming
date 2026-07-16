# brainstorming Phases 1–2: Kernel + TUI Demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the group-chat kernel (transcript, mention routing, round-budget cascade engine, `AgentAdapter` contract) and an Ink TUI, fully working end to end with scripted `FakeAdapter`s via `brainstorming --demo` — zero real-agent quota used.

**Architecture:** pnpm workspace monorepo. `@brainstorming/core` is a UI-free kernel: an append-only `TranscriptStore` is the source of truth; a `Room` orchestrates delivery waves to `AgentAdapter`s (digest + addressed message), enforces the agent-to-agent round budget, and emits `RoomEvent`s. `@brainstorming/tui` renders those events with Ink (finalized messages in `<Static>`, live streaming blocks below). `apps/cli` wires four FakeAdapters in `--demo` mode. Real adapters (Ollama/Claude/Codex/Gemini) come in later plans and only implement `AgentAdapter`.

**Tech Stack:** TypeScript 5 (strict, ESM/NodeNext), pnpm workspaces, vitest, Ink 6 + React 19, tsx (dev runner). No runtime deps in core beyond Node builtins.

**Spec:** `docs/superpowers/specs/2026-07-16-brainstorming-tui-design.md` (covers phases 1–2 of it; later phases get their own plans).

## Global Constraints

- All file contents in English (code, comments, docs, commits).
- TypeScript `strict: true`; ESM with `module: NodeNext` — **relative imports must end in `.js`** (e.g. `import { x } from "./types.js"`).
- Node ≥ 24, pnpm (installed: pnpm 11). No build step in this plan: package `exports` point at `src/index.ts`; vitest/tsx consume TS directly.
- No hardcoded model names anywhere.
- Commit after every task; message format `feat|test|chore: …`, each commit ends with trailer line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (use a second `-m`).
- Run commands from repo root `/home/aildan/Projects/brainstorming` unless stated.
- Deviation from spec (intentional): `FakeAdapter` lives in `@brainstorming/core` (not `packages/adapters`) so core tests avoid a circular dev-dependency; the adapters package arrives in the next plan.

---

### Task 1: Monorepo scaffold + core types

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/src/types.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/types.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: every type later tasks import from `@brainstorming/core`: `ChatMessage`, `MessageKind`, `ToolActivity`, `PermissionRequest`, `PermissionDecision`, `QuotaInfo`, `AdapterError`, `AgentEvent`, `PromptInput`, `AdapterContext`, `AgentAdapter`.

- [ ] **Step 1: Write workspace + root config files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json` (root):
```json
{
  "name": "brainstorming-monorepo",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "demo": "pnpm --filter brainstorming demo"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["packages/*/src/**/*", "packages/*/test/**/*", "apps/*/src/**/*"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["packages/**/test/**/*.test.ts", "packages/**/test/**/*.test.tsx"],
  },
});
```

- [ ] **Step 2: Create the core package with all shared types**

`packages/core/package.json`:
```json
{
  "name": "@brainstorming/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/core/src/types.ts`:
```ts
/** Message author: the human user, the system, or an agent name from the roster. */
export type Author = "user" | "system" | (string & {});

export type MessageKind = "chat" | "activity" | "permission" | "system";

export interface ChatMessage {
  id: string;
  ts: number; // epoch ms
  author: Author;
  content: string;
  /** Roster names this message addresses (already resolved, no "@" prefix, no "all"). */
  mentions: string[];
  kind: MessageKind;
}

export interface ToolActivity {
  kind: "command" | "file-change" | "tool";
  title: string; // e.g. `ran: pnpm test`
  detail?: string;
  status: "running" | "ok" | "failed";
}

export interface PermissionRequest {
  id: string;
  agent: string;
  action: string; // e.g. "run command"
  preview: string; // command line or diff
}

export type PermissionDecision = "allow-once" | "allow-session" | "deny";

export interface QuotaInfo {
  usedPercent?: number;
  resetsAt?: string;
  note?: string;
}

export interface AdapterError {
  message: string;
  fatal: boolean;
}

export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "activity"; activity: ToolActivity }
  | {
      type: "permission-request";
      request: PermissionRequest;
      respond: (decision: PermissionDecision) => void;
    }
  | { type: "usage"; info: QuotaInfo }
  | { type: "done"; finalText: string }
  | { type: "error"; error: AdapterError };

export interface PromptInput {
  /** Messages the agent has not seen yet, excluding the addressed message and its own. */
  digest: ChatMessage[];
  /** The message that triggered this prompt. */
  addressed: ChatMessage;
}

export interface AdapterContext {
  workspaceDir: string;
  /** Rendered persona / group-chat protocol text for this participant. */
  persona: string;
  /** Native session/thread id saved in room.json, when resuming. */
  savedSessionId?: string;
}

export interface AgentAdapter {
  readonly name: string;
  readonly capabilities: { tools: boolean; steering: boolean; resume: boolean };
  start(ctx: AdapterContext): Promise<void>;
  prompt(input: PromptInput, signal: AbortSignal): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  /** Graceful shutdown; returns the native session id to persist, if any. */
  stop(): Promise<string | undefined>;
}
```

`packages/core/src/index.ts`:
```ts
export * from "./types.js";
```

- [ ] **Step 3: Write a smoke test**

`packages/core/test/types.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent, ChatMessage } from "@brainstorming/core";

describe("core types", () => {
  it("constructs a ChatMessage and an AgentEvent", () => {
    const msg: ChatMessage = {
      id: "m1",
      ts: 0,
      author: "user",
      content: "hello @claude",
      mentions: ["claude"],
      kind: "chat",
    };
    const ev: AgentEvent = { type: "text-delta", text: "hi" };
    expect(msg.mentions).toEqual(["claude"]);
    expect(ev.type).toBe("text-delta");
  });
});
```

- [ ] **Step 4: Install and verify**

Run: `pnpm install && pnpm test && pnpm typecheck`
Expected: install succeeds; vitest reports `1 passed`; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: scaffold pnpm monorepo with core types and AgentAdapter contract" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Mention parser

**Files:**
- Create: `packages/core/src/mentions.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/mentions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseMentions(content: string, roster: string[]): string[]` — lowercase roster names in first-mention order, deduped; `@all` expands to the full roster (roster order); unknown mentions ignored.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/mentions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseMentions } from "@brainstorming/core";

const ROSTER = ["claude", "codex", "gemini", "ollama"];

describe("parseMentions", () => {
  it("finds roster mentions in first-mention order, deduped", () => {
    expect(parseMentions("@codex then @claude then @codex again", ROSTER)).toEqual([
      "codex",
      "claude",
    ]);
  });

  it("is case-insensitive and ignores unknown names", () => {
    expect(parseMentions("@Claude @nobody @GEMINI", ROSTER)).toEqual(["claude", "gemini"]);
  });

  it("expands @all to the whole roster in roster order", () => {
    expect(parseMentions("@all thoughts?", ROSTER)).toEqual(ROSTER);
  });

  it("returns empty array when no mentions", () => {
    expect(parseMentions("no mentions here", ROSTER)).toEqual([]);
  });

  it("matches names containing dots, dashes, colons", () => {
    expect(parseMentions("@ollama:qwen hi", ["ollama:qwen"])).toEqual(["ollama:qwen"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/test/mentions.test.ts`
Expected: FAIL — `parseMentions` is not exported.

- [ ] **Step 3: Implement**

`packages/core/src/mentions.ts`:
```ts
const MENTION_RE = /@([a-z0-9][a-z0-9._:-]*)/gi;

export const ALL_MENTION = "all";

/**
 * Extract roster mentions from a message. `@all` expands to the full roster.
 * Returns lowercase names in first-mention order, deduped.
 */
export function parseMentions(content: string, roster: string[]): string[] {
  const known = new Set(roster.map((n) => n.toLowerCase()));
  const found: string[] = [];
  for (const match of content.matchAll(MENTION_RE)) {
    const name = match[1].toLowerCase();
    if (name === ALL_MENTION) return [...roster];
    if (known.has(name) && !found.includes(name)) found.push(name);
  }
  return found;
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./mentions.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/test/mentions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mentions.ts packages/core/src/index.ts packages/core/test/mentions.test.ts
git commit -m "feat: mention parser with @all expansion" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Transcript store (memory + JSONL file)

**Files:**
- Create: `packages/core/src/transcript.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/transcript.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` (Task 1).
- Produces: `class TranscriptStore { constructor(filePath?: string); append(msg: ChatMessage): void; all(): readonly ChatMessage[]; get length(): number; static load(filePath: string): TranscriptStore }`. File-backed stores append one JSON line per message; `load` restores from disk.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/transcript.test.ts`:
```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TranscriptStore, type ChatMessage } from "@brainstorming/core";

function msg(id: string, content: string): ChatMessage {
  return { id, ts: 1, author: "user", content, mentions: [], kind: "chat" };
}

describe("TranscriptStore", () => {
  it("appends and reads back in order (memory)", () => {
    const t = new TranscriptStore();
    t.append(msg("a", "one"));
    t.append(msg("b", "two"));
    expect(t.length).toBe(2);
    expect(t.all().map((m) => m.content)).toEqual(["one", "two"]);
  });

  it("persists to a JSONL file and loads back", () => {
    const file = join(mkdtempSync(join(tmpdir(), "bs-")), "room.jsonl");
    const t = new TranscriptStore(file);
    t.append(msg("a", "hello"));
    t.append(msg("b", "world"));
    const loaded = TranscriptStore.load(file);
    expect(loaded.length).toBe(2);
    expect(loaded.all()[1].content).toBe("world");
  });

  it("load tolerates a missing file (starts empty)", () => {
    const file = join(mkdtempSync(join(tmpdir(), "bs-")), "missing.jsonl");
    const t = TranscriptStore.load(file);
    expect(t.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/test/transcript.test.ts`
Expected: FAIL — `TranscriptStore` is not exported.

- [ ] **Step 3: Implement**

`packages/core/src/transcript.ts`:
```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatMessage } from "./types.js";

/**
 * Append-only message log — the room's source of truth.
 * Memory-only when constructed without a path; JSONL-backed otherwise.
 */
export class TranscriptStore {
  #messages: ChatMessage[] = [];
  #filePath?: string;

  constructor(filePath?: string) {
    this.#filePath = filePath;
    if (filePath) mkdirSync(dirname(filePath), { recursive: true });
  }

  static load(filePath: string): TranscriptStore {
    const store = new TranscriptStore(filePath);
    if (existsSync(filePath)) {
      for (const line of readFileSync(filePath, "utf8").split("\n")) {
        if (line.trim()) store.#messages.push(JSON.parse(line) as ChatMessage);
      }
    }
    return store;
  }

  append(msg: ChatMessage): void {
    this.#messages.push(msg);
    if (this.#filePath) appendFileSync(this.#filePath, JSON.stringify(msg) + "\n");
  }

  all(): readonly ChatMessage[] {
    return this.#messages;
  }

  get length(): number {
    return this.#messages.length;
  }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./transcript.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/test/transcript.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transcript.ts packages/core/src/index.ts packages/core/test/transcript.test.ts
git commit -m "feat: append-only transcript store with JSONL persistence" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Target resolution (sticky routing)

**Files:**
- Create: `packages/core/src/router.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/router.test.ts`

**Interfaces:**
- Consumes: nothing (pure function; caller supplies parsed mentions).
- Produces: `resolveTargets(args: { mentions: string[]; sticky: string[] }): string[]` — mentions win; otherwise sticky; empty result means "needs target".

- [ ] **Step 1: Write the failing tests**

`packages/core/test/router.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolveTargets } from "@brainstorming/core";

describe("resolveTargets", () => {
  it("uses mentions when present", () => {
    expect(resolveTargets({ mentions: ["codex"], sticky: ["claude"] })).toEqual(["codex"]);
  });

  it("falls back to sticky targets when no mentions", () => {
    expect(resolveTargets({ mentions: [], sticky: ["claude", "gemini"] })).toEqual([
      "claude",
      "gemini",
    ]);
  });

  it("returns empty when neither mentions nor sticky exist", () => {
    expect(resolveTargets({ mentions: [], sticky: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/test/router.test.ts`
Expected: FAIL — `resolveTargets` is not exported.

- [ ] **Step 3: Implement**

`packages/core/src/router.ts`:
```ts
/** Mentions always win; un-mentioned messages continue with the previous (sticky) targets. */
export function resolveTargets(args: { mentions: string[]; sticky: string[] }): string[] {
  if (args.mentions.length > 0) return [...args.mentions];
  return [...args.sticky];
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./router.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/test/router.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/router.ts packages/core/src/index.ts packages/core/test/router.test.ts
git commit -m "feat: sticky target resolution" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Prompt rendering (digest delivery format)

**Files:**
- Create: `packages/core/src/prompt.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/prompt.test.ts`

**Interfaces:**
- Consumes: `PromptInput`, `ChatMessage` (Task 1).
- Produces: `renderPrompt(input: PromptInput): string` and `formatLine(msg: ChatMessage): string` (`[author]: content`). This exact text is what every adapter sends to its agent.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/prompt.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { renderPrompt, type ChatMessage } from "@brainstorming/core";

function msg(author: string, content: string): ChatMessage {
  return { id: author + content, ts: 1, author, content, mentions: [], kind: "chat" };
}

describe("renderPrompt", () => {
  it("renders digest section plus addressed message with [author] attribution", () => {
    const text = renderPrompt({
      digest: [msg("user", "hi everyone"), msg("claude", "hello!")],
      addressed: msg("user", "@codex your turn"),
    });
    expect(text).toBe(
      [
        "[Chat since your last turn]",
        "[user]: hi everyone",
        "[claude]: hello!",
        "---",
        "[You are addressed]",
        "[user]: @codex your turn",
      ].join("\n"),
    );
  });

  it("omits the digest section when empty", () => {
    const text = renderPrompt({ digest: [], addressed: msg("user", "hello") });
    expect(text).toBe(["[You are addressed]", "[user]: hello"].join("\n"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/test/prompt.test.ts`
Expected: FAIL — `renderPrompt` is not exported.

- [ ] **Step 3: Implement**

`packages/core/src/prompt.ts`:
```ts
import type { ChatMessage, PromptInput } from "./types.js";

export function formatLine(msg: ChatMessage): string {
  return `[${msg.author}]: ${msg.content}`;
}

/** Render the uniform text protocol delivered to every agent. */
export function renderPrompt(input: PromptInput): string {
  const lines: string[] = [];
  if (input.digest.length > 0) {
    lines.push("[Chat since your last turn]");
    for (const m of input.digest) lines.push(formatLine(m));
    lines.push("---");
  }
  lines.push("[You are addressed]");
  lines.push(formatLine(input.addressed));
  return lines.join("\n");
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./prompt.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/test/prompt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/prompt.ts packages/core/src/index.ts packages/core/test/prompt.test.ts
git commit -m "feat: uniform prompt rendering for digest delivery" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: FakeAdapter (scripted agent for tests + demo)

**Files:**
- Create: `packages/core/src/fake-adapter.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/fake-adapter.test.ts`

**Interfaces:**
- Consumes: `AgentAdapter`, `AgentEvent`, `PromptInput`, `PermissionDecision`, `ToolActivity` (Task 1).
- Produces:
  - `interface FakeReply { match?: RegExp; reply: string; activity?: ToolActivity; permission?: { action: string; preview: string; denyReply?: string }; error?: string }`
  - `interface FakeScript { replies?: FakeReply[]; defaultReply?: string; chunkDelayMs?: number }`
  - `class FakeAdapter implements AgentAdapter { constructor(name: string, script?: FakeScript); lastInput: PromptInput | null }`
  - Behavior contract Room relies on: streams `text-delta` word chunks, ends with exactly one `done` whose `finalText` equals the full reply; `match` is tested against `addressed.content`; permission request pauses the stream until `respond` is called; `error` yields an `error` event and stops; respects `AbortSignal` (stops yielding, no `done`).

- [ ] **Step 1: Write the failing tests**

`packages/core/test/fake-adapter.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  FakeAdapter,
  type AgentEvent,
  type ChatMessage,
  type PermissionDecision,
} from "@brainstorming/core";

function addressed(content: string): ChatMessage {
  return { id: "x", ts: 1, author: "user", content, mentions: [], kind: "chat" };
}

async function collect(
  adapter: FakeAdapter,
  content: string,
  decide?: PermissionDecision,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const ac = new AbortController();
  for await (const ev of adapter.prompt({ digest: [], addressed: addressed(content) }, ac.signal)) {
    events.push(ev);
    if (ev.type === "permission-request" && decide) ev.respond(decide);
  }
  return events;
}

describe("FakeAdapter", () => {
  it("streams deltas and ends with done matching the scripted reply", async () => {
    const fake = new FakeAdapter("claude", {
      replies: [{ match: /api/i, reply: "REST is fine." }],
      defaultReply: "hm",
    });
    const events = await collect(fake, "which API style?");
    const deltas = events.filter((e) => e.type === "text-delta");
    const done = events.at(-1);
    expect(deltas.length).toBeGreaterThan(1);
    expect(done).toEqual({ type: "done", finalText: "REST is fine." });
    expect(fake.lastInput?.addressed.content).toBe("which API style?");
  });

  it("uses defaultReply when nothing matches", async () => {
    const fake = new FakeAdapter("gemini", { defaultReply: "no opinion" });
    const events = await collect(fake, "anything");
    expect(events.at(-1)).toEqual({ type: "done", finalText: "no opinion" });
  });

  it("pauses on permission and continues on allow with activity", async () => {
    const fake = new FakeAdapter("codex", {
      replies: [
        {
          match: /tests/,
          reply: "All green.",
          permission: { action: "run command", preview: "pnpm test" },
          activity: { kind: "command", title: "ran: pnpm test", status: "ok" },
        },
      ],
    });
    const events = await collect(fake, "run the tests", "allow-once");
    expect(events[0].type).toBe("permission-request");
    expect(events.some((e) => e.type === "activity")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", finalText: "All green." });
  });

  it("replies with denyReply on deny and skips the activity", async () => {
    const fake = new FakeAdapter("codex", {
      replies: [
        {
          match: /tests/,
          reply: "All green.",
          permission: { action: "run command", preview: "pnpm test", denyReply: "Skipped." },
          activity: { kind: "command", title: "ran: pnpm test", status: "ok" },
        },
      ],
    });
    const events = await collect(fake, "run the tests", "deny");
    expect(events.some((e) => e.type === "activity")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done", finalText: "Skipped." });
  });

  it("yields an error event when scripted", async () => {
    const fake = new FakeAdapter("claude", { replies: [{ match: /boom/, reply: "", error: "kaput" }] });
    const events = await collect(fake, "boom");
    expect(events).toEqual([{ type: "error", error: { message: "kaput", fatal: false } }]);
  });

  it("stops without done when aborted", async () => {
    const fake = new FakeAdapter("claude", { defaultReply: "one two three four", chunkDelayMs: 5 });
    const ac = new AbortController();
    const events: AgentEvent[] = [];
    for await (const ev of fake.prompt({ digest: [], addressed: addressed("go") }, ac.signal)) {
      events.push(ev);
      ac.abort();
    }
    expect(events.some((e) => e.type === "done")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/test/fake-adapter.test.ts`
Expected: FAIL — `FakeAdapter` is not exported.

- [ ] **Step 3: Implement**

`packages/core/src/fake-adapter.ts`:
```ts
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  AdapterContext,
  AgentAdapter,
  AgentEvent,
  PermissionDecision,
  PromptInput,
  ToolActivity,
} from "./types.js";

export interface FakeReply {
  match?: RegExp;
  reply: string;
  activity?: ToolActivity;
  permission?: { action: string; preview: string; denyReply?: string };
  error?: string;
}

export interface FakeScript {
  replies?: FakeReply[];
  defaultReply?: string;
  chunkDelayMs?: number;
}

/** Deterministic scripted adapter: powers kernel tests and `--demo` mode. */
export class FakeAdapter implements AgentAdapter {
  readonly capabilities = { tools: false, steering: false, resume: false };
  lastInput: PromptInput | null = null;
  #script: Required<FakeScript>;

  constructor(
    readonly name: string,
    script: FakeScript = {},
  ) {
    this.#script = { replies: [], defaultReply: "(no reply)", chunkDelayMs: 0, ...script };
  }

  async start(_ctx: AdapterContext): Promise<void> {}
  async interrupt(): Promise<void> {}
  async stop(): Promise<string | undefined> {
    return undefined;
  }

  async *prompt(input: PromptInput, signal: AbortSignal): AsyncIterable<AgentEvent> {
    this.lastInput = input;
    const rule = this.#script.replies.find(
      (r) => !r.match || r.match.test(input.addressed.content),
    );
    if (rule?.error) {
      yield { type: "error", error: { message: rule.error, fatal: false } };
      return;
    }
    let reply = rule?.reply ?? this.#script.defaultReply;
    let denied = false;

    if (rule?.permission) {
      let resolveDecision!: (d: PermissionDecision) => void;
      const decision = new Promise<PermissionDecision>((res) => (resolveDecision = res));
      yield {
        type: "permission-request",
        request: {
          id: randomUUID(),
          agent: this.name,
          action: rule.permission.action,
          preview: rule.permission.preview,
        },
        respond: (d) => resolveDecision(d),
      };
      denied = (await decision) === "deny";
      if (denied) reply = rule.permission.denyReply ?? "Understood, I won't.";
    }
    if (rule?.activity && !denied) yield { type: "activity", activity: rule.activity };

    for (const chunk of reply.split(/(?<= )/)) {
      if (signal.aborted) return;
      if (this.#script.chunkDelayMs > 0) await sleep(this.#script.chunkDelayMs);
      yield { type: "text-delta", text: chunk };
    }
    yield { type: "done", finalText: reply };
  }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./fake-adapter.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/test/fake-adapter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fake-adapter.ts packages/core/src/index.ts packages/core/test/fake-adapter.test.ts
git commit -m "feat: scripted FakeAdapter implementing the AgentAdapter contract" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Room — user wave (delivery, sticky, statuses, errors)

**Files:**
- Create: `packages/core/src/room.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/room.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces (later tasks and the TUI rely on these exact names):
  - `type AgentStatus = "idle" | "thinking" | "awaiting-permission"`
  - `interface PendingMention { from: string; to: string; message: ChatMessage }`
  - `type RoomEvent = { type: "message"; message: ChatMessage } | { type: "agent-status"; agent: string; status: AgentStatus } | { type: "stream-delta"; agent: string; text: string } | { type: "permission"; agent: string; request: PermissionRequest; respond: (d: PermissionDecision) => void } | { type: "budget-exhausted"; pending: PendingMention[] } | { type: "agent-error"; agent: string; error: AdapterError }`
  - `type SendResult = { status: "sent" } | { status: "needs-target" }`
  - `class Room { constructor(opts: { transcript: TranscriptStore; adapters: AgentAdapter[]; roundBudget?: number }); get roster(): string[]; get stickyTargets(): string[]; get pendingMentions(): PendingMention[]; setRoundBudget(n: number): void; on(fn: (ev: RoomEvent) => void): () => void; start(ctx: AdapterContext): Promise<void>; sendUserMessage(content: string): Promise<SendResult>; continueCascade(): Promise<void>; interrupt(): void }`
  - Delivery rule: digest = all transcript messages the agent hasn't seen, minus its own and the addressed one; the agent's cursor advances to the transcript snapshot length at delivery time. Agent replies are appended as `kind: "chat"` with mentions parsed against the roster minus self. Activities append as `kind: "activity"` messages (content = `activity.title`, prefixed `▸ `). Adapter `error` events append a `[system]` note (`kind: "system"`) and emit `agent-error`; the wave continues for other agents.

*(This task implements user-triggered waves only; the agent-to-agent cascade rounds arrive in Task 8 inside the same file.)*

- [ ] **Step 1: Write the failing tests**

`packages/core/test/room.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  FakeAdapter,
  Room,
  TranscriptStore,
  type RoomEvent,
} from "@brainstorming/core";

const CTX = { workspaceDir: "/tmp", persona: "" };

function makeRoom(adapters: FakeAdapter[], roundBudget = 3) {
  const room = new Room({ transcript: new TranscriptStore(), adapters, roundBudget });
  const events: RoomEvent[] = [];
  room.on((ev) => events.push(ev));
  return { room, events };
}

describe("Room user wave", () => {
  it("returns needs-target when there is no mention and no sticky", async () => {
    const { room } = makeRoom([new FakeAdapter("claude")]);
    await room.start(CTX);
    const res = await room.sendUserMessage("hello there");
    expect(res).toEqual({ status: "needs-target" });
    expect(room.roster).toEqual(["claude"]);
  });

  it("delivers to the mentioned agent and appends its reply", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "hi!" });
    const { room, events } = makeRoom([claude]);
    await room.start(CTX);
    const res = await room.sendUserMessage("@claude hello");
    expect(res).toEqual({ status: "sent" });
    const chat = events.filter((e) => e.type === "message").map((e) => e.message);
    expect(chat.map((m) => [m.author, m.content])).toEqual([
      ["user", "@claude hello"],
      ["claude", "hi!"],
    ]);
  });

  it("sticky: un-mentioned follow-up goes to the previous targets", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "yes" });
    const codex = new FakeAdapter("codex", { defaultReply: "nope" });
    const { room, events } = makeRoom([claude, codex]);
    await room.start(CTX);
    await room.sendUserMessage("@claude first");
    await room.sendUserMessage("and again");
    const authors = events
      .filter((e) => e.type === "message")
      .map((e) => e.message.author);
    expect(authors).toEqual(["user", "claude", "user", "claude"]);
    expect(room.stickyTargets).toEqual(["claude"]);
  });

  it("@all prompts every agent and digest carries missed messages", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "opinion A" });
    const codex = new FakeAdapter("codex", { defaultReply: "opinion B" });
    const { room } = makeRoom([claude, codex]);
    await room.start(CTX);
    await room.sendUserMessage("@claude warmup");
    await room.sendUserMessage("@all thoughts?");
    // codex never saw the warmup exchange: it must arrive in its digest
    const digestAuthors = codex.lastInput!.digest.map((m) => m.author);
    expect(digestAuthors).toEqual(["user", "claude"]);
    expect(codex.lastInput!.addressed.content).toBe("@all thoughts?");
  });

  it("adapter error appends a system note and other agents still reply", async () => {
    const claude = new FakeAdapter("claude", { replies: [{ match: /.*/, reply: "", error: "kaput" }] });
    const codex = new FakeAdapter("codex", { defaultReply: "still here" });
    const { room, events } = makeRoom([claude, codex]);
    await room.start(CTX);
    await room.sendUserMessage("@all go");
    const msgs = events.filter((e) => e.type === "message").map((e) => e.message);
    expect(msgs.some((m) => m.kind === "system" && m.content.includes("claude"))).toBe(true);
    expect(msgs.some((m) => m.author === "codex" && m.content === "still here")).toBe(true);
    expect(events.some((e) => e.type === "agent-error" && e.agent === "claude")).toBe(true);
  });

  it("emits thinking→idle status around a delivery", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "ok" });
    const { room, events } = makeRoom([claude]);
    await room.start(CTX);
    await room.sendUserMessage("@claude hello");
    const statuses = events
      .filter((e) => e.type === "agent-status" && e.agent === "claude")
      .map((e) => e.status);
    expect(statuses).toEqual(["thinking", "idle"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/test/room.test.ts`
Expected: FAIL — `Room` is not exported.

- [ ] **Step 3: Implement**

`packages/core/src/room.ts`:
```ts
import { randomUUID } from "node:crypto";
import type {
  AdapterContext,
  AdapterError,
  AgentAdapter,
  ChatMessage,
  MessageKind,
  PermissionDecision,
  PermissionRequest,
} from "./types.js";
import { parseMentions } from "./mentions.js";
import { resolveTargets } from "./router.js";
import { TranscriptStore } from "./transcript.js";

export type AgentStatus = "idle" | "thinking" | "awaiting-permission";

export interface PendingMention {
  from: string;
  to: string;
  message: ChatMessage;
}

export type RoomEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "agent-status"; agent: string; status: AgentStatus }
  | { type: "stream-delta"; agent: string; text: string }
  | {
      type: "permission";
      agent: string;
      request: PermissionRequest;
      respond: (d: PermissionDecision) => void;
    }
  | { type: "budget-exhausted"; pending: PendingMention[] }
  | { type: "agent-error"; agent: string; error: AdapterError };

export type SendResult = { status: "sent" } | { status: "needs-target" };

interface Delivery {
  to: string[];
  message: ChatMessage;
}

/** Orchestrates delivery waves between the user and the agents over one shared transcript. */
export class Room {
  #transcript: TranscriptStore;
  #adapters = new Map<string, AgentAdapter>();
  #cursors = new Map<string, number>();
  #sticky: string[] = [];
  #listeners = new Set<(ev: RoomEvent) => void>();
  #roundBudget: number;
  #abort: AbortController | null = null;
  #pending: PendingMention[] = [];

  constructor(opts: {
    transcript: TranscriptStore;
    adapters: AgentAdapter[];
    roundBudget?: number;
  }) {
    this.#transcript = opts.transcript;
    for (const a of opts.adapters) this.#adapters.set(a.name, a);
    this.#roundBudget = opts.roundBudget ?? 3;
  }

  get roster(): string[] {
    return [...this.#adapters.keys()];
  }
  get stickyTargets(): string[] {
    return [...this.#sticky];
  }
  get pendingMentions(): PendingMention[] {
    return [...this.#pending];
  }
  get transcript(): TranscriptStore {
    return this.#transcript;
  }

  setRoundBudget(n: number): void {
    this.#roundBudget = n;
  }

  on(fn: (ev: RoomEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  async start(ctx: AdapterContext): Promise<void> {
    await Promise.all([...this.#adapters.values()].map((a) => a.start(ctx)));
  }

  async sendUserMessage(content: string): Promise<SendResult> {
    const mentions = parseMentions(content, this.roster);
    const targets = resolveTargets({ mentions, sticky: this.#sticky });
    if (targets.length === 0) return { status: "needs-target" };
    this.#sticky = targets;
    const msg = this.#append("user", content, "chat", targets);
    await this.#runCascade([{ to: targets, message: msg }]);
    return { status: "sent" };
  }

  async continueCascade(): Promise<void> {
    if (this.#pending.length === 0) return;
    const pending = this.#pending;
    this.#pending = [];
    await this.#runCascade(pending.map((p) => ({ to: [p.to], message: p.message })));
  }

  interrupt(): void {
    this.#abort?.abort();
  }

  #emit(ev: RoomEvent): void {
    for (const fn of this.#listeners) fn(ev);
  }

  #append(author: string, content: string, kind: MessageKind, mentions: string[]): ChatMessage {
    const msg: ChatMessage = { id: randomUUID(), ts: Date.now(), author, content, mentions, kind };
    this.#transcript.append(msg);
    this.#emit({ type: "message", message: msg });
    return msg;
  }

  #status(agent: string, status: AgentStatus): void {
    this.#emit({ type: "agent-status", agent, status });
  }

  async #runCascade(firstWave: Delivery[]): Promise<void> {
    const ac = new AbortController();
    this.#abort = ac;
    let wave = firstWave;
    let round = 0; // user-triggered wave is round 0; agent-to-agent waves consume budget
    try {
      while (wave.length > 0) {
        const deliveries = wave.flatMap((d) => d.to.map((agent) => ({ agent, message: d.message })));
        const replies = await Promise.all(
          deliveries.map((d) => this.#deliver(d.agent, d.message, ac.signal)),
        );
        if (ac.signal.aborted) {
          this.#append("system", "cascade interrupted", "system", []);
          return;
        }
        const next: Delivery[] = [];
        for (const reply of replies) {
          if (!reply) continue;
          const targets = reply.mentions.filter((t) => t !== reply.author);
          if (targets.length > 0) next.push({ to: targets, message: reply });
        }
        if (next.length === 0) return;
        round += 1;
        if (round > this.#roundBudget) {
          this.#pending = next.flatMap((d) =>
            d.to.map((to) => ({ from: d.message.author, to, message: d.message })),
          );
          this.#append(
            "system",
            `round budget (${this.#roundBudget}) exhausted — pending: ` +
              this.#pending.map((p) => `${p.from}→@${p.to}`).join(", ") +
              " — use /continue to let them proceed",
            "system",
            [],
          );
          this.#emit({ type: "budget-exhausted", pending: this.pendingMentions });
          return;
        }
        wave = next;
      }
    } finally {
      this.#abort = null;
    }
  }

  async #deliver(
    agentName: string,
    addressed: ChatMessage,
    signal: AbortSignal,
  ): Promise<ChatMessage | null> {
    const adapter = this.#adapters.get(agentName);
    if (!adapter || signal.aborted) return null;
    const snapshot = this.#transcript.all();
    const cursor = this.#cursors.get(agentName) ?? 0;
    const digest = snapshot
      .slice(cursor)
      .filter((m) => m.id !== addressed.id && m.author !== agentName);
    this.#cursors.set(agentName, snapshot.length);

    this.#status(agentName, "thinking");
    let acc = "";
    let final: string | null = null;
    try {
      for await (const ev of adapter.prompt({ digest, addressed }, signal)) {
        switch (ev.type) {
          case "text-delta":
            acc += ev.text;
            this.#emit({ type: "stream-delta", agent: agentName, text: ev.text });
            break;
          case "activity":
            this.#append(agentName, `▸ ${ev.activity.title}`, "activity", []);
            break;
          case "permission-request": {
            this.#status(agentName, "awaiting-permission");
            const respond = (d: PermissionDecision) => {
              this.#status(agentName, "thinking");
              ev.respond(d);
            };
            this.#emit({ type: "permission", agent: agentName, request: ev.request, respond });
            break;
          }
          case "usage":
            break; // surfaced in a later phase
          case "done":
            final = ev.finalText;
            break;
          case "error":
            this.#emit({ type: "agent-error", agent: agentName, error: ev.error });
            this.#append("system", `@${agentName} failed: ${ev.error.message}`, "system", []);
            return null;
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        const error: AdapterError = { message: String(err), fatal: false };
        this.#emit({ type: "agent-error", agent: agentName, error });
        this.#append("system", `@${agentName} failed: ${error.message}`, "system", []);
      }
      return null;
    } finally {
      this.#status(agentName, "idle");
    }

    const text = (final ?? acc).trim();
    if (!text) return null;
    const mentions = parseMentions(text, this.roster).filter((n) => n !== agentName);
    return this.#append(agentName, text, "chat", mentions);
  }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from "./room.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/test/room.test.ts`
Expected: PASS (6 tests). Also run the full suite: `pnpm test` — everything green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/room.ts packages/core/src/index.ts packages/core/test/room.test.ts
git commit -m "feat: Room kernel with digest delivery, sticky routing, statuses, error notes" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Room — agent-to-agent cascade, budget, /continue, interrupt

**Files:**
- Modify: `packages/core/src/room.ts` (already implemented in Task 7 — this task adds the tests that pin the behavior; fix the implementation if any test fails)
- Test: `packages/core/test/cascade.test.ts`

**Interfaces:**
- Consumes: `Room`, `FakeAdapter`, `RoomEvent`, `PendingMention` (Tasks 6–7).
- Produces: verified cascade semantics — budget N allows N agent-to-agent waves after the user wave; exhaustion stores `pendingMentions`, appends a `[system]` note containing `/continue`, and emits `budget-exhausted`; `continueCascade()` re-runs with a fresh budget; `interrupt()` aborts mid-stream and appends a `cascade interrupted` system note.

- [ ] **Step 1: Write the tests**

`packages/core/test/cascade.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  FakeAdapter,
  Room,
  TranscriptStore,
  type RoomEvent,
} from "@brainstorming/core";

const CTX = { workspaceDir: "/tmp", persona: "" };

function pingPongRoom(roundBudget: number) {
  const claude = new FakeAdapter("claude", {
    replies: [{ match: /ping|pong/i, reply: "@codex pong" }],
  });
  const codex = new FakeAdapter("codex", {
    replies: [{ match: /ping|pong/i, reply: "@claude ping" }],
  });
  const room = new Room({ transcript: new TranscriptStore(), adapters: [claude, codex], roundBudget });
  const events: RoomEvent[] = [];
  room.on((ev) => events.push(ev));
  return { room, events };
}

describe("cascade engine", () => {
  it("one consult round: reply mentioning another agent triggers exactly one delivery", async () => {
    const claude = new FakeAdapter("claude", {
      replies: [{ match: /api/i, reply: "REST. @codex agree?" }],
    });
    const codex = new FakeAdapter("codex", {
      replies: [{ match: /agree/i, reply: "Agreed." }],
      defaultReply: "hm",
    });
    const { room, events } = (() => {
      const room = new Room({
        transcript: new TranscriptStore(),
        adapters: [claude, codex],
        roundBudget: 3,
      });
      const events: RoomEvent[] = [];
      room.on((ev) => events.push(ev));
      return { room, events };
    })();
    await room.start(CTX);
    await room.sendUserMessage("@claude which api style?");
    const chat = events
      .filter((e) => e.type === "message")
      .map((e) => [e.message.author, e.message.content]);
    expect(chat).toEqual([
      ["user", "@claude which api style?"],
      ["claude", "REST. @codex agree?"],
      ["codex", "Agreed."],
    ]);
    expect(room.pendingMentions).toEqual([]);
  });

  it("stops at the round budget, stores pending, emits budget-exhausted", async () => {
    const { room, events } = pingPongRoom(2);
    await room.start(CTX);
    await room.sendUserMessage("@claude ping");
    // user wave: claude replies; round1: codex; round2: claude; round3 would be codex -> pends
    const chatAuthors = events
      .filter((e) => e.type === "message" && e.message.kind === "chat")
      .map((e) => e.message.author);
    expect(chatAuthors).toEqual(["user", "claude", "codex", "claude"]);
    expect(room.pendingMentions.map((p) => [p.from, p.to])).toEqual([["claude", "codex"]]);
    expect(events.some((e) => e.type === "budget-exhausted")).toBe(true);
    const note = events.find((e) => e.type === "message" && e.message.kind === "system");
    expect(note && note.type === "message" && note.message.content).toContain("/continue");
  });

  it("continueCascade resumes with a fresh budget", async () => {
    const { room, events } = pingPongRoom(1);
    await room.start(CTX);
    await room.sendUserMessage("@claude ping");
    const before = events.filter((e) => e.type === "message" && e.message.kind === "chat").length;
    await room.continueCascade();
    const after = events.filter((e) => e.type === "message" && e.message.kind === "chat").length;
    expect(after).toBeGreaterThan(before);
    expect(room.pendingMentions.length).toBeGreaterThan(0); // ping-pong pends again
  });

  it("interrupt aborts mid-stream and appends an interrupted note", async () => {
    const claude = new FakeAdapter("claude", {
      defaultReply: "a very long answer indeed",
      chunkDelayMs: 10,
    });
    const room = new Room({ transcript: new TranscriptStore(), adapters: [claude], roundBudget: 3 });
    const events: RoomEvent[] = [];
    room.on((ev) => {
      events.push(ev);
      if (ev.type === "stream-delta") room.interrupt();
    });
    await room.start(CTX);
    await room.sendUserMessage("@claude go");
    expect(
      events.some(
        (e) => e.type === "message" && e.message.kind === "system" && /interrupted/.test(e.message.content),
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run packages/core/test/cascade.test.ts`
Expected: PASS if Task 7's implementation is correct. If any test fails, fix `packages/core/src/room.ts` until green — the tests in this file are the specification; do not weaken them.

- [ ] **Step 3: Run the full suite**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/cascade.test.ts packages/core/src/room.ts
git commit -m "test: pin cascade semantics (round budget, continue, interrupt)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: TUI — read-only chat view

**Files:**
- Create: `packages/tui/package.json`, `packages/tui/src/index.ts`, `packages/tui/src/theme.ts`, `packages/tui/src/use-room.ts`, `packages/tui/src/app.tsx`, `packages/tui/src/components/transcript.tsx`, `packages/tui/src/components/live-blocks.tsx`, `packages/tui/src/components/status-bar.tsx`
- Test: `packages/tui/test/app.test.tsx`

**Interfaces:**
- Consumes: `Room`, `RoomEvent`, `ChatMessage`, `AgentStatus`, `PermissionRequest`, `PermissionDecision`, `PendingMention` from `@brainstorming/core`.
- Produces:
  - `authorColor(name: string): string` (theme).
  - `interface PermissionPrompt { agent: string; request: PermissionRequest; respond: (d: PermissionDecision) => void }`
  - `interface RoomView { messages: ChatMessage[]; live: ReadonlyMap<string, string>; statuses: ReadonlyMap<string, AgentStatus>; permissions: PermissionPrompt[]; notice: string | null }`
  - `useRoom(room: Room): RoomView` hook.
  - `<App room={room} />` component (input handling added in Task 10).

- [ ] **Step 1: Create the package and install deps**

`packages/tui/package.json`:
```json
{
  "name": "@brainstorming/tui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@brainstorming/core": "workspace:*",
    "ink": "^6.0.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "ink-testing-library": "^4.0.0"
  }
}
```

Run: `pnpm install`
Expected: dependencies resolve (a peer-dependency warning from ink-testing-library is acceptable; a hard resolution failure is not — if it fails, retry with the latest ink-testing-library version).

- [ ] **Step 2: Write the failing render test**

`packages/tui/test/app.test.tsx`:
```tsx
import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { FakeAdapter, Room, TranscriptStore } from "@brainstorming/core";
import { App } from "@brainstorming/tui";

const CTX = { workspaceDir: "/tmp", persona: "" };

describe("App", () => {
  it("renders roster in status bar and finalized messages in transcript", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "hello human" });
    const room = new Room({ transcript: new TranscriptStore(), adapters: [claude] });
    await room.start(CTX);
    const { lastFrame } = render(<App room={room} />);
    await room.sendUserMessage("@claude hi");
    await new Promise((r) => setTimeout(r, 20));
    const frame = lastFrame()!;
    expect(frame).toContain("claude");        // status bar
    expect(frame).toContain("[user]");        // finalized user message
    expect(frame).toContain("hello human");   // agent reply
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/tui/test/app.test.tsx`
Expected: FAIL — `App` is not exported / package sources missing.

- [ ] **Step 4: Implement the components**

`packages/tui/src/theme.ts`:
```ts
const PALETTE = ["yellow", "green", "blue", "magenta", "red", "white"] as const;

/** Stable color per author: user is cyan, system gray, agents from the palette. */
export function authorColor(name: string): string {
  if (name === "user") return "cyan";
  if (name === "system") return "gray";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
```

`packages/tui/src/use-room.ts`:
```ts
import { useEffect, useState } from "react";
import type {
  AgentStatus,
  ChatMessage,
  PermissionDecision,
  PermissionRequest,
  Room,
} from "@brainstorming/core";

export interface PermissionPrompt {
  agent: string;
  request: PermissionRequest;
  respond: (d: PermissionDecision) => void;
}

export interface RoomView {
  messages: ChatMessage[];
  live: ReadonlyMap<string, string>;
  statuses: ReadonlyMap<string, AgentStatus>;
  permissions: PermissionPrompt[];
  notice: string | null;
}

/** Subscribe to RoomEvents and project them into immutable view state. */
export function useRoom(room: Room): RoomView {
  const [messages, setMessages] = useState<ChatMessage[]>([...room.transcript.all()]);
  const [live, setLive] = useState<ReadonlyMap<string, string>>(new Map());
  const [statuses, setStatuses] = useState<ReadonlyMap<string, AgentStatus>>(
    new Map(room.roster.map((n) => [n, "idle" as AgentStatus])),
  );
  const [permissions, setPermissions] = useState<PermissionPrompt[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    return room.on((ev) => {
      switch (ev.type) {
        case "message":
          setMessages((prev) => [...prev, ev.message]);
          if (ev.message.author !== "user" && ev.message.author !== "system") {
            setLive((prev) => {
              const next = new Map(prev);
              next.delete(ev.message.author);
              return next;
            });
          }
          break;
        case "stream-delta":
          setLive((prev) => {
            const next = new Map(prev);
            next.set(ev.agent, (next.get(ev.agent) ?? "") + ev.text);
            return next;
          });
          break;
        case "agent-status":
          setStatuses((prev) => new Map(prev).set(ev.agent, ev.status));
          if (ev.status === "idle") {
            setLive((prev) => {
              const next = new Map(prev);
              next.delete(ev.agent);
              return next;
            });
          }
          break;
        case "permission": {
          const prompt: PermissionPrompt = {
            agent: ev.agent,
            request: ev.request,
            respond: ev.respond,
          };
          setPermissions((prev) => [...prev, prompt]);
          break;
        }
        case "budget-exhausted":
          setNotice("Round budget exhausted — /continue to let agents proceed.");
          break;
        case "agent-error":
          setNotice(`@${ev.agent} error: ${ev.error.message}`);
          break;
      }
    });
  }, [room]);

  return { messages, live, statuses, permissions, notice };
}

/** Remove the answered permission from the queue (used by App). */
export function dropPermission(list: PermissionPrompt[], target: PermissionPrompt): PermissionPrompt[] {
  return list.filter((p) => p !== target);
}
```

`packages/tui/src/components/transcript.tsx`:
```tsx
import React from "react";
import { Box, Static, Text } from "ink";
import type { ChatMessage } from "@brainstorming/core";
import { authorColor } from "../theme.js";

export function Transcript({ messages }: { messages: ChatMessage[] }) {
  return (
    <Static items={messages}>
      {(m) => (
        <Box key={m.id} marginBottom={m.kind === "chat" ? 1 : 0}>
          {m.kind === "chat" ? (
            <Text>
              <Text bold color={authorColor(m.author)}>
                [{m.author}]
              </Text>
              <Text> {m.content}</Text>
            </Text>
          ) : (
            <Text dimColor italic={m.kind === "system"}>
              {m.kind === "system" ? `— ${m.content} —` : m.content}
            </Text>
          )}
        </Box>
      )}
    </Static>
  );
}
```

`packages/tui/src/components/live-blocks.tsx`:
```tsx
import React from "react";
import { Box, Text } from "ink";
import { authorColor } from "../theme.js";

export function LiveBlocks({ live }: { live: ReadonlyMap<string, string> }) {
  return (
    <Box flexDirection="column">
      {[...live.entries()].map(([agent, text]) => (
        <Box key={agent}>
          <Text>
            <Text bold color={authorColor(agent)}>
              [{agent}]
            </Text>
            <Text> {text}</Text>
            <Text dimColor>▋</Text>
          </Text>
        </Box>
      ))}
    </Box>
  );
}
```

`packages/tui/src/components/status-bar.tsx`:
```tsx
import React from "react";
import { Box, Text } from "ink";
import type { AgentStatus } from "@brainstorming/core";
import { authorColor } from "../theme.js";

const DOT: Record<AgentStatus, string> = {
  idle: "●",
  thinking: "◐",
  "awaiting-permission": "◍",
};

export function StatusBar({
  title,
  statuses,
}: {
  title: string;
  statuses: ReadonlyMap<string, AgentStatus>;
}) {
  return (
    <Box borderStyle="round" paddingX={1} justifyContent="space-between">
      <Text bold>{title}</Text>
      <Text>
        {[...statuses.entries()].map(([name, status]) => (
          <Text key={name}>
            {" "}
            <Text color={status === "idle" ? "gray" : authorColor(name)}>{DOT[status]}</Text>
            <Text> {name}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}
```

`packages/tui/src/app.tsx` (read-only version; input arrives in Task 10):
```tsx
import React from "react";
import { Box, Text } from "ink";
import type { Room } from "@brainstorming/core";
import { useRoom } from "./use-room.js";
import { Transcript } from "./components/transcript.js";
import { LiveBlocks } from "./components/live-blocks.js";
import { StatusBar } from "./components/status-bar.js";

export function App({ room, title = "brainstorming" }: { room: Room; title?: string }) {
  const view = useRoom(room);
  return (
    <Box flexDirection="column">
      <StatusBar title={title} statuses={view.statuses} />
      <Transcript messages={view.messages} />
      <LiveBlocks live={view.live} />
      {view.notice ? <Text color="yellow">{view.notice}</Text> : null}
    </Box>
  );
}
```

`packages/tui/src/index.ts`:
```ts
export * from "./app.js";
export * from "./use-room.js";
export * from "./theme.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/tui/test/app.test.tsx`
Expected: PASS. Also `pnpm typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add packages/tui pnpm-lock.yaml
git commit -m "feat: Ink TUI read-only chat view (Static transcript, live blocks, status bar)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: TUI — input, autocomplete, commands, permission card

**Files:**
- Create: `packages/tui/src/components/chat-input.tsx`, `packages/tui/src/components/permission-card.tsx`, `packages/tui/src/commands.ts`
- Modify: `packages/tui/src/app.tsx`, `packages/tui/src/index.ts`
- Test: `packages/tui/test/commands.test.ts`, `packages/tui/test/input.test.tsx`

**Interfaces:**
- Consumes: `RoomView`, `PermissionPrompt`, `dropPermission` (Task 9); `Room` API (Task 7).
- Produces:
  - `parseCommand(line: string): { kind: "message"; content: string } | { kind: "quit" } | { kind: "continue" } | { kind: "budget"; n: number } | { kind: "help" } | { kind: "unknown"; name: string }`
  - `<ChatInput roster onSubmit(line) disabled />` — single-line input, `@`-token autocomplete via Tab, Enter submits.
  - `<PermissionCard prompt />` — renders agent/action/preview and the `i / o / r` key legend (keys handled in App).
  - App keyboard behavior: when a permission is queued, `i`=allow-once, `o`=allow-session, `r`=deny answer the first card; ESC calls `room.interrupt()`; typed lines route through `parseCommand`; `needs-target` result shows a notice.

- [ ] **Step 1: Write the failing command-parser test**

`packages/tui/test/commands.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseCommand } from "@brainstorming/tui";

describe("parseCommand", () => {
  it("passes plain text through as a message", () => {
    expect(parseCommand("hello @claude")).toEqual({ kind: "message", content: "hello @claude" });
  });
  it("parses /quit, /continue, /help", () => {
    expect(parseCommand("/quit")).toEqual({ kind: "quit" });
    expect(parseCommand("/continue")).toEqual({ kind: "continue" });
    expect(parseCommand("/help")).toEqual({ kind: "help" });
  });
  it("parses /budget N", () => {
    expect(parseCommand("/budget 5")).toEqual({ kind: "budget", n: 5 });
  });
  it("flags unknown commands", () => {
    expect(parseCommand("/wat now")).toEqual({ kind: "unknown", name: "wat" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/tui/test/commands.test.ts`
Expected: FAIL — `parseCommand` is not exported.

- [ ] **Step 3: Implement commands, input, permission card, and wire the App**

`packages/tui/src/commands.ts`:
```ts
export type Command =
  | { kind: "message"; content: string }
  | { kind: "quit" }
  | { kind: "continue" }
  | { kind: "budget"; n: number }
  | { kind: "help" }
  | { kind: "unknown"; name: string };

export function parseCommand(line: string): Command {
  if (!line.startsWith("/")) return { kind: "message", content: line };
  const [name, ...rest] = line.slice(1).split(/\s+/);
  switch (name) {
    case "quit":
      return { kind: "quit" };
    case "continue":
      return { kind: "continue" };
    case "help":
      return { kind: "help" };
    case "budget": {
      const n = Number(rest[0]);
      if (Number.isInteger(n) && n > 0) return { kind: "budget", n };
      return { kind: "unknown", name: "budget" };
    }
    default:
      return { kind: "unknown", name };
  }
}

export const HELP_TEXT =
  "commands: /continue /budget N /help /quit — mention with @name or @all; ESC interrupts";
```

`packages/tui/src/components/chat-input.tsx`:
```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

/** Current @-token under the cursor (end of line), or null. */
export function mentionPrefix(value: string): string | null {
  const m = /(?:^|\s)@([a-z0-9._:-]*)$/i.exec(value);
  return m ? m[1].toLowerCase() : null;
}

export function suggestions(value: string, roster: string[]): string[] {
  const prefix = mentionPrefix(value);
  if (prefix === null) return [];
  return ["all", ...roster].filter((n) => n.startsWith(prefix) && n !== prefix);
}

export function ChatInput({
  roster,
  onSubmit,
  disabled,
}: {
  roster: string[];
  onSubmit: (line: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const hints = suggestions(value, roster);

  useInput(
    (input, key) => {
      if (key.return) {
        const line = value.trim();
        if (line) {
          setValue("");
          onSubmit(line);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        return;
      }
      if (key.tab) {
        if (hints.length > 0) {
          const prefix = mentionPrefix(value)!;
          setValue((v) => v.slice(0, v.length - prefix.length) + hints[0] + " ");
        }
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.escape) setValue((v) => v + input);
    },
    { isActive: !disabled },
  );

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingX={1}>
        <Text>
          {"> "}
          {value}
          <Text inverse> </Text>
        </Text>
      </Box>
      {hints.length > 0 ? (
        <Text dimColor>tab: {hints.map((h) => "@" + h).join("  ")}</Text>
      ) : null}
    </Box>
  );
}
```

`packages/tui/src/components/permission-card.tsx`:
```tsx
import React from "react";
import { Box, Text } from "ink";
import { authorColor } from "../theme.js";
import type { PermissionPrompt } from "../use-room.js";

export function PermissionCard({ prompt }: { prompt: PermissionPrompt }) {
  return (
    <Box borderStyle="double" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Text>
        <Text bold color="yellow">
          PERMISSION{" "}
        </Text>
        <Text bold color={authorColor(prompt.agent)}>
          @{prompt.agent}
        </Text>
        <Text> wants to {prompt.request.action}</Text>
      </Text>
      <Text dimColor>{prompt.request.preview}</Text>
      <Text>
        <Text color="green">[i]</Text> allow once <Text color="green">[o]</Text> allow for session{" "}
        <Text color="red">[r]</Text> deny
      </Text>
    </Box>
  );
}
```

Replace `packages/tui/src/app.tsx` with the wired version:
```tsx
import React, { useCallback, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { Room } from "@brainstorming/core";
import { dropPermission, useRoom, type PermissionPrompt } from "./use-room.js";
import { Transcript } from "./components/transcript.js";
import { LiveBlocks } from "./components/live-blocks.js";
import { StatusBar } from "./components/status-bar.js";
import { ChatInput } from "./components/chat-input.js";
import { PermissionCard } from "./components/permission-card.js";
import { HELP_TEXT, parseCommand } from "./commands.js";

export function App({ room, title = "brainstorming" }: { room: Room; title?: string }) {
  const view = useRoom(room);
  const { exit } = useApp();
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [answered, setAnswered] = useState<PermissionPrompt[]>([]);
  const pendingCards = view.permissions.filter((p) => !answered.includes(p));
  const activeCard = pendingCards[0] ?? null;

  useInput((input, key) => {
    if (key.escape) {
      room.interrupt();
      return;
    }
    if (activeCard) {
      if (input === "i") answer(activeCard, "allow-once");
      else if (input === "o") answer(activeCard, "allow-session");
      else if (input === "r") answer(activeCard, "deny");
    }
  });

  const answer = (card: PermissionPrompt, decision: Parameters<PermissionPrompt["respond"]>[0]) => {
    setAnswered((prev) => [...prev, card]);
    card.respond(decision);
  };

  const handleSubmit = useCallback(
    (line: string) => {
      setLocalNotice(null);
      const cmd = parseCommand(line);
      switch (cmd.kind) {
        case "quit":
          exit();
          return;
        case "help":
          setLocalNotice(HELP_TEXT);
          return;
        case "budget":
          room.setRoundBudget(cmd.n);
          setLocalNotice(`round budget set to ${cmd.n}`);
          return;
        case "continue":
          void room.continueCascade();
          return;
        case "unknown":
          setLocalNotice(`unknown command: /${cmd.name} — ${HELP_TEXT}`);
          return;
        case "message":
          void room.sendUserMessage(cmd.content).then((res) => {
            if (res.status === "needs-target") {
              setLocalNotice("No target: mention someone, e.g. @claude or @all.");
            }
          });
      }
    },
    [room, exit],
  );

  const notice = localNotice ?? view.notice;
  return (
    <Box flexDirection="column">
      <StatusBar title={title} statuses={view.statuses} />
      <Transcript messages={view.messages} />
      <LiveBlocks live={view.live} />
      {activeCard ? <PermissionCard prompt={activeCard} /> : null}
      {notice ? <Text color="yellow">{notice}</Text> : null}
      <ChatInput roster={room.roster} onSubmit={handleSubmit} disabled={activeCard !== null} />
    </Box>
  );
}
```

Update `packages/tui/src/index.ts`:
```ts
export * from "./app.js";
export * from "./use-room.js";
export * from "./theme.js";
export * from "./commands.js";
export { mentionPrefix, suggestions } from "./components/chat-input.js";
```

- [ ] **Step 4: Write the input/interaction test**

`packages/tui/test/input.test.tsx`:
```tsx
import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { FakeAdapter, Room, TranscriptStore } from "@brainstorming/core";
import { App, suggestions } from "@brainstorming/tui";

const CTX = { workspaceDir: "/tmp", persona: "" };

describe("input", () => {
  it("suggests roster completions for an @ token", () => {
    expect(suggestions("hey @c", ["claude", "codex"])).toEqual(["claude", "codex"]);
    expect(suggestions("hey @cl", ["claude", "codex"])).toEqual(["claude"]);
    expect(suggestions("plain text", ["claude"])).toEqual([]);
  });

  it("typed message reaches the room and needs-target notice appears without mention", async () => {
    const claude = new FakeAdapter("claude", { defaultReply: "yo" });
    const room = new Room({ transcript: new TranscriptStore(), adapters: [claude] });
    await room.start(CTX);
    const { stdin, lastFrame } = render(<App room={room} />);
    stdin.write("hello");
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()!).toContain("No target");
    stdin.write("@claude hi");
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    expect(lastFrame()!).toContain("yo");
  });
});
```

- [ ] **Step 5: Run all TUI tests**

Run: `pnpm vitest run packages/tui`
Expected: PASS (commands, input, app render). Then `pnpm test && pnpm typecheck` — everything green.

- [ ] **Step 6: Commit**

```bash
git add packages/tui
git commit -m "feat: TUI input with mention autocomplete, slash commands, permission cards" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: CLI `--demo` mode + end-to-end verification

**Files:**
- Create: `apps/cli/package.json`, `apps/cli/src/index.ts`, `apps/cli/src/demo.ts`
- Create: `README.md`
- Test: manual checklist (below) — this task wires existing tested pieces.

**Interfaces:**
- Consumes: `Room`, `TranscriptStore`, `FakeAdapter` (core); `App` (tui).
- Produces: `pnpm demo` (root script → `brainstorming` package's `demo` script) launching the full TUI group chat with four scripted fakes.

- [ ] **Step 1: Create the CLI package**

`apps/cli/package.json`:
```json
{
  "name": "brainstorming",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "brainstorming": "./src/index.ts" },
  "scripts": {
    "demo": "tsx src/index.ts --demo"
  },
  "dependencies": {
    "@brainstorming/core": "workspace:*",
    "@brainstorming/tui": "workspace:*",
    "ink": "^6.0.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "@types/react": "^19.0.0"
  }
}
```

`apps/cli/src/demo.ts`:
```ts
import { FakeAdapter } from "@brainstorming/core";

/**
 * Demo roster. Scripted to exercise every kernel feature:
 * - "api" topic: claude consults codex (one cascade round)
 * - "pingpong": claude/codex mention each other forever -> round budget stops them
 * - "tests": codex asks permission, runs an activity on allow
 */
export function demoAdapters(): FakeAdapter[] {
  return [
    new FakeAdapter("claude", {
      chunkDelayMs: 15,
      replies: [
        { match: /rest|graphql|api/i, reply: "I lean REST here — simpler caching. @codex do you agree?" },
        { match: /ping|pong/i, reply: "@codex pong" },
      ],
      defaultReply: "Interesting. What is the goal?",
    }),
    new FakeAdapter("codex", {
      chunkDelayMs: 15,
      replies: [
        { match: /do you agree/i, reply: "Agreed — versioned REST plus OpenAPI. I can scaffold it." },
        { match: /ping|pong/i, reply: "@claude ping" },
        {
          match: /test/i,
          reply: "Ran the tests — all green.",
          permission: { action: "run command", preview: "pnpm test", denyReply: "Okay, skipping the test run." },
          activity: { kind: "command", title: "ran: pnpm test (12 passed)", status: "ok" },
        },
      ],
      defaultReply: "Give me a concrete task and I will do it.",
    }),
    new FakeAdapter("gemini", {
      chunkDelayMs: 15,
      defaultReply: "Alternative view: consider the long-term client list before deciding.",
    }),
    new FakeAdapter("ollama", {
      chunkDelayMs: 15,
      defaultReply: "Opinion: keep it boring and ship.",
    }),
  ];
}
```

`apps/cli/src/index.ts`:
```ts
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
    roundBudget: budget,
  });
  await room.start({ workspaceDir: process.cwd(), persona: "" });
  render(React.createElement(App, { room, title: "brainstorming (demo)" }));
}

void main();
```

`README.md`:
```markdown
# brainstorming

A terminal group chat where multiple AI coding agents (Claude Code, Codex,
Gemini CLI, Ollama models) collaborate in one shared conversation over a real
codebase: shared context, parallel opinions, @-mention task delegation, and
agent-to-agent consultation — orchestrated by you.

Status: early development. The kernel and TUI work end to end with scripted
fake agents; real agent adapters are being added phase by phase.

## Try the demo (no AI quota used)

```bash
pnpm install
pnpm demo
```

Then, in the chat:

- `@all which API style should we use?` — parallel opinions; claude consults codex automatically
- `@claude pingpong` — watch the round budget stop an infinite agent loop, then `/continue`
- `@codex run the tests` — a permission card appears; press `i` (allow), `o` (allow for session) or `r` (deny)
- `/help` — command list; `ESC` interrupts a running cascade; `/quit` exits

## Development

```bash
pnpm test        # vitest unit tests
pnpm typecheck   # strict TypeScript
```

Design docs live in `docs/superpowers/specs/`.
```

- [ ] **Step 2: Install and run the automated checks**

Run: `pnpm install && pnpm test && pnpm typecheck`
Expected: all green.

- [ ] **Step 3: Manual end-to-end verification (interactive)**

Run: `pnpm demo` in a real terminal and verify each item:

1. Status bar shows `claude codex gemini ollama` with idle dots.
2. Type `hello` + Enter → notice: "No target: mention someone…".
3. Type `@all which api style?` → all four stream in parallel; claude's reply mentions @codex → codex answers once more (cascade round 1); transcript order stays readable.
4. Type `pingpong` (sticky targets from previous message deliver it) or `@claude pingpong` → after 3 agent-to-agent rounds a system note appears: "round budget (3) exhausted … /continue"; `/continue` resumes and stops again.
5. Type `@codex run the tests` → permission card appears, input disabled; press `r` → codex replies "Okay, skipping…"; repeat and press `i` → activity line `▸ ran: pnpm test (12 passed)` + reply "Ran the tests — all green."
6. Start a long reply (`@claude pingpong`) and press ESC mid-stream → "cascade interrupted" note; agents return to idle.
7. `/budget 1` → notice confirms; pingpong now stops after 1 round.
8. `/quit` exits cleanly.

Expected: every item behaves as described. Fix and re-run until they do.

- [ ] **Step 4: Commit**

```bash
git add apps/cli README.md pnpm-lock.yaml
git commit -m "feat: brainstorming --demo CLI wiring the kernel and TUI with scripted agents" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Plan Self-Review (completed by author)

- **Spec coverage (phases 1–2):** monorepo layout ✓ (T1), transcript source of truth ✓ (T3), mention/sticky/@all routing ✓ (T2/T4/T7), digest delivery with `[author]:` attribution ✓ (T5/T7), round budget + `/continue` + ESC ✓ (T8), AgentAdapter contract + FakeAdapter ✓ (T1/T6), permission cards ✓ (T6/T10), statuses ✓ (T7/T9), Static-based transcript ✓ (T9), commands ✓ (T10), `--demo` ✓ (T11). Deferred to later plans per spec phasing: real adapters, `/decide`, work lock, resume, quota meters, room.json persistence wiring in CLI.
- **Placeholder scan:** no TBDs; every step has complete code or exact commands.
- **Type consistency:** `RoomEvent`/`AgentStatus`/`PermissionPrompt`/`parseCommand` names cross-checked between Tasks 7, 9, 10; `FakeScript` fields (`replies/defaultReply/chunkDelayMs/error`) consistent between Tasks 6, 8, 11.
