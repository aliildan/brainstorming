# brainstorming — Multi-Agent Collaborative Dev Chat TUI (Design Spec)

Status: approved 2026-07-16

## Purpose

A terminal chat application where multiple AI coding agents — Claude Code, OpenAI Codex, Gemini CLI, and Ollama cloud models — participate in **one shared conversation** over a real codebase. All participants share context (messages, decisions), can give opinions simultaneously, can be delegated real work via @-mentions ("@codex you do this part"), and can consult each other. The human orchestrates; agents collaborate.

Prior-art research (2026-07-16) confirmed this exact product does not yet exist as a TUI (closest: `agentchattr`, a Python web app). The lane "TypeScript Ink TUI, true multi-vendor group chat over structured sessions" is open.

## Constraints and environment

- TypeScript. All file contents (code, docs, comments, commits) in English.
- Agents connect through the **installed CLIs using existing subscriptions** — persistent stateful sessions, explicitly NOT one-shot headless calls. No API keys.
- Verified environment: `claude` 2.1.211, `codex` 0.144.3, `gemini` 0.23.0 (upgrade planned), `ollama` 0.15.5-rc3 — all installed and authenticated. Node v24.12.0, pnpm 11.1.2, Linux.

## Product decisions

1. **UI**: TUI built with Ink 6 (React 19).
2. **Routing**: mentions always route; un-mentioned messages go to **sticky targets** (previous message's targets); `@all` broadcasts to everyone in parallel; first message with no target → TUI asks (no silent quota burn).
3. **Agent-to-agent**: automatic delivery of cross-agent mentions with a **round budget per user message** (default 3, configurable); on exhaustion → system note listing pending mentions + `/continue`; user mentions exempt; ESC interrupts any cascade.
4. **Scope**: all four agents in v1.
5. **Architecture**: best native surface per agent behind one common `AgentAdapter` interface (interface kept ACP-flavored so a generic ACP adapter can join later).

## Integration surfaces (research-verified facts that constrain implementation)

### Claude → `@anthropic-ai/claude-agent-sdk`
- Streaming input mode: `query({ prompt: asyncGenerator })` keeps ONE session alive indefinitely; push new user messages by yielding. Resume across restarts via `options.resume: sessionId` (capture `session_id` from init/result messages).
- Auth: uses the CLI subscription OAuth automatically. **Ensure `ANTHROPIC_API_KEY` is not set in the child env** (it would override subscription auth).
- Permissions: `canUseTool` async callback (no timeout) → surface in our TUI; `permissionMode` for auto-edit tiers.
- Persona: `systemPrompt: { type: "preset", preset: "claude_code", append: "<group-chat protocol>" }`.
- Gotcha: experimental V2 session API was removed from the SDK; use `query()` + async generator.

### Codex → `codex app-server` (JSON-RPC 2.0 over stdio, one long-lived child)
- The interface the official VS Code extension uses. Methods: `initialize`, `thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `turn/interrupt`, `thread/compact/start`, `account/rateLimits/read`.
- Notifications: `item/agentMessage/delta` (true text deltas), `item/commandExecution/outputDelta`, `item/started|completed`, `turn/diff/updated`, `turn/completed`, `account/rateLimits/updated`.
- Approvals: server→client JSON-RPC **requests** `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`; respond `{decision: "accept"|"acceptForSession"|"decline"|"cancel"}`. This is the ONLY Codex surface with human-in-the-loop approvals — headless `codex exec`/SDK hard-codes approvals off (verified in source).
- Generate typed TS bindings from the installed binary: `codex app-server generate-ts --out <dir>` (regenerate on CLI upgrades; pin versions).
- Threads persist in `~/.codex/sessions/…` and are resumable across restarts (`thread/resume`). One active turn per thread — serialize per participant.
- Requires a git repo (or `skipGitRepoCheck`). Sandbox `workspace-write`; network inside sandbox OFF by default (`networkAccessEnabled`). Quota: each `turn/start` = one "local message" in the ChatGPT plan's 5h window; watch `account/rateLimits/*`.
- Persona: spawn with `-c developer_instructions="…"` (validated) and/or `AGENTS.md` in workspace.

### Gemini → ACP (`gemini --experimental-acp` on 0.23.0; `--acp` on current)
- Client lib: **`@agentclientprotocol/sdk` ^1.2.1** (the old `@zed-industries/agent-client-protocol` package is deprecated). JSON-RPC over stdio, protocol v1: `initialize`, `session/new`, `session/prompt`, `session/cancel`; notifications `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`; permissions via `session/request_permission` (`allow_once`/`allow_always`/`reject_once`).
- Installed 0.23.0 advertises `loadSession: false` (no cross-restart resume) — **upgrade gemini-cli to latest (≥0.50)** for `session/load`; fallback: fresh session + transcript digest re-brief.
- Auth: `oauth-personal` creds already cached → works immediately. Free Code Assist quota: 60 req/min, 1000 req/day.
- Persona: `GEMINI_SYSTEM_MD=<file>` env var per spawned process (full system prompt replacement; file must exist) — derive from `GEMINI_WRITE_SYSTEM_MD` dump to keep tool instructions; `GEMINI.md` for lighter context.
- Known bug: stray plain-text log lines can corrupt the JSON-RPC stdout stream → defensive NDJSON framing (skip non-JSON lines).

### Ollama → official `ollama` npm (^0.6.3), no subprocess
- Cloud models (`*-cloud`) are proxied through local `ollama serve` at `http://127.0.0.1:11434` with the standard `/api/chat` — signin already done, cloud models pulled.
- We own the message history (the app's history array IS the session; rebuild from transcript on resume). `stream: true` returns an AsyncGenerator; `abort()` to cancel.
- Free plan: **1 concurrent cloud model** → the adapter serializes its own turns. Cloud models get retired on a schedule → model names live in config only.
- No agentic harness: v1 Ollama participants are **chat-only (opinions)**; later option: point an agent harness (e.g. OpenCode) at Ollama for tool use.

### Prior-art patterns adopted
- Transcript is the durable source of truth; any agent can be cold-restarted and re-briefed from it.
- Per-agent pending queue + **digest delivery**: agents receive missed messages only when next prompted (no quota burn for spectating).
- Round/hop budgets enforced in core (not client-side), human mentions bypass.
- Agent-origin messages can never approve permissions; only the human answers permission cards.
- Structured session channels only — no tmux keystroke injection/screen scraping (every project that tried it died).

## Architecture

### Repo layout (pnpm workspace monorepo)

```
brainstorming/
├── packages/core/       # kernel: room, transcript store, router, round-budget engine,
│                        # digest builder, work lock, AgentAdapter interface, event bus. No UI deps.
├── packages/adapters/   # claude.ts, codex.ts (+ generated appserver types), gemini.ts, ollama.ts, fake.ts
├── packages/tui/        # Ink 6 components: transcript view (Static-based), input w/ @-autocomplete,
│                        # permission cards, status bar, command palette
├── apps/cli/            # `brainstorming` bin: config load, wiring, room open/resume
└── docs/                # ARCHITECTURE.md, superpowers/specs/…
```

TypeScript strict, ESM, vitest, tsup (or tsc) builds.

### Core model

- **Room** = shared conversation bound to a workspace dir. State in `<workspace>/.brainstorming/`: `room.jsonl` (append-only transcript, source of truth) + `room.json` (participants, native session/thread ids, settings). `.brainstorming/` gitignored by default; `DECISIONS.md` in the workspace root is NOT ignored.
- **ChatMessage**: `{ id, ts, author: "user"|agentName, content, mentions: string[], kind: "chat"|"activity"|"permission"|"system" }`.
- **AgentAdapter interface** (the contract everything implements):

```ts
interface AgentAdapter {
  readonly name: string;                       // "claude" | "codex" | "gemini" | "ollama:<model>" | custom
  readonly capabilities: { tools: boolean; steering: boolean; resume: boolean };
  start(ctx: AdapterContext): Promise<void>;   // spawn/connect; ctx: workspace, persona, saved native id
  prompt(input: PromptInput, signal: AbortSignal): AsyncIterable<AgentEvent>;
    // PromptInput = { digest: ChatMessage[]; addressed: ChatMessage }
  interrupt(): Promise<void>;
  stop(): Promise<void>;                       // graceful shutdown, return native id for room.json
}
type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "activity"; activity: ToolActivity }          // command run, file change, mcp call
  | { type: "permission-request"; req: PermissionRequest; respond(d: PermissionDecision): void }
  | { type: "usage"; info: QuotaInfo }
  | { type: "done"; finalText: string }
  | { type: "error"; error: AdapterError };
```

- **Digest delivery**: core keeps a per-agent cursor into the transcript. On prompt, everything since the agent's last turn is rendered as an attributed digest (`[user]: …`, `[claude]: …`, `[decision]: …`) followed by the addressed message. All content delivered to agents uses `[author]:` attribution.
- **Persona/system prompt** per agent: identity ("You are @codex…"), roster, protocol (address others with `@name`, keep chat replies brief, do real work in the workspace when asked, propose decisions with a `DECISION:` block).

### Routing & cascade engine

- Parse `@name`/`@all` mentions (user and agent messages alike). Targets: mentions > sticky (previous user-message targets) > ask via TUI (first message).
- `@all` → prompt all agents in parallel (each response streams as its own block). Ollama adapter serializes internally.
- Agent replies containing mentions trigger automatic delivery, decrementing the per-user-message **round budget** (default 3). Exhausted → system note listing pending mentions + `/continue`. ESC aborts the whole cascade (AbortSignal through adapters). Self-mentions ignored. No mentions in a reply → cascade ends.

### Permissions & write coordination

- All three agentic adapters route native permission/approval requests into one unified TUI **permission card**: agent, action, diff/command preview → allow once / allow for session / deny. Only the human answers.
- Per-agent permission mode in config: `ask` (default) / `auto-edit` / `full-auto`, mapped to each surface (Claude `permissionMode`, Codex `approvalPolicy`+sandbox, Gemini approval mode / `session/set_mode`).
- **Work lock**: one "worker" agent at a time — while agent X holds the lock (granted on first write-type permission), other agents' write-type permission requests queue (all surfaces naturally pause awaiting the response). Same-file edits within a short window → collision warning system note.

### Decisions

- `/decide <text>` appends to `<workspace>/DECISIONS.md` + transcript system note; decisions are prioritized in every agent's next digest. Agents can propose (`DECISION:` block in a reply) → confirmation card to the user.

### Persistence & resume

- Reopening a room: Codex `thread/resume`, Claude `resume: sessionId`, Gemini `session/load` (post-upgrade; else fresh + digest re-brief), Ollama history rebuilt from transcript. Universal fallback for any lost native session: cold start + digest re-brief.

### TUI (Ink 6, React 19)

- Header: room/workspace, per-agent status dots (idle/thinking/working/awaiting-permission/quota-muted), round-budget indicator, quota warnings (Codex `rateLimits` gives usedPercent + resetsAt).
- Transcript: color-coded author tags; finalized blocks go into Ink `Static` (proven perf pattern for long chats); live streaming blocks below; collapsed activity lines (`▸ @codex ran: pnpm test (✓)`); permission cards with `i/o/r` keys.
- Input: multiline, `@` autocomplete, `/` commands: `/decide`, `/continue`, `/budget N`, `/mute @agent`, `/model @agent=…`, `/help`, `/quit`. ESC = interrupt.

### Error handling

- Adapter crash → red status, system note, bounded auto-restart + native resume.
- Quota exhausted → agent muted with reset time when known; others continue.
- Gemini NDJSON corruption → skip non-JSON lines. Codex non-git dir → offer `git init`. Turn timeout configurable.

### Config

- Global `~/.config/brainstorming/config.json` + per-room `.brainstorming/room.json`, zod-validated. Agents: enabled, model, persona extras, permission mode; budgets; NO hardcoded model names anywhere.

### Testing

- vitest unit tests: mention parser, router, round-budget cascade, digest builder, transcript store, work lock.
- **FakeAdapter**: deterministic scripted AgentAdapter — powers core tests AND `brainstorming --demo` (full group-chat UX with zero quota).
- Adapter contract suite run against all adapters; real-agent smoke tests opt-in behind env flag.
- TUI: ink-testing-library.

## Implementation phases (all v1; riskiest core first)

1. **Scaffold + kernel**: pnpm monorepo, strict TS, core types, transcript store, mention parser, router + round-budget engine, digest builder — all tested against FakeAdapter.
2. **TUI shell** on FakeAdapter: transcript rendering (Static), input + autocomplete, streaming blocks, `--demo` mode works end to end.
3. **Ollama adapter** (simplest real surface; validates streaming + history rebuild). Serialize turns.
4. **Claude adapter**: Agent SDK streaming-input session, canUseTool → permission events, resume.
5. **Codex adapter**: spawn `codex app-server`, generate TS bindings from installed binary, thread lifecycle, deltas, approvals, rateLimits.
6. **Gemini adapter**: upgrade gemini-cli, ACP client via `@agentclientprotocol/sdk`, `GEMINI_SYSTEM_MD` persona, defensive framing.
7. **Permissions unification + work lock + collision notes** across the three agentic adapters.
8. **Resume flow, `/decide`, quota meters, polish, docs** (English README + ARCHITECTURE.md).

Key packages to pin: `@anthropic-ai/claude-agent-sdk`, `@agentclientprotocol/sdk@^1.2`, `ollama@^0.6`, `ink@^6`, `react@^19`, `zod`, `vitest`. Codex: generated bindings from installed CLI (no SDK dep needed for app-server path).

## Verification

1. **Unit/kernel**: `pnpm test` — router, budget, digest, transcript, lock (no quota).
2. **Demo**: `brainstorming --demo` in a scratch dir — scripted FakeAdapters exercise: sticky routing, @all parallel blocks, agent-to-agent cascade stopping at budget + `/continue`, permission card flow, ESC interrupt.
3. **Real smoke** (opt-in, burns quota, in a scratch git repo): each agent answers a direct mention; `@all` yields 4 parallel opinions; `@codex` performs a real file edit through a permission card; kill the TUI, reopen, verify all agents resume with context (ask "what did we decide?").
