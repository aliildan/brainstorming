<div align="center">

<img src="https://raw.githubusercontent.com/aliildan/brainstorming/main/logo.png" alt="brainstorming" width="360" />

### One terminal. Every AI coding agent. Same conversation.

**brainstorming** is a TUI where Claude Code, OpenAI Codex, Google Antigravity and Ollama models
sit in **one shared chat** over your codebase — trading opinions, taking on tasks you @-mention,
and consulting each other while you steer.

[![npm](https://img.shields.io/npm/v/brainstorming.svg)](https://www.npmjs.com/package/brainstorming)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)

</div>

---

<div align="center">

<video src="https://raw.githubusercontent.com/aliildan/brainstorming/main/demo.webm" controls muted width="760"></video>

<sub>▶️ <a href="https://github.com/aliildan/brainstorming/blob/main/demo.webm">Watch the demo</a> — four agents in one shared chat over a codebase.</sub>

</div>

---

## Why

You already pay for Claude, ChatGPT/Codex, Gemini/Antigravity and run Ollama. But they each live in
their own window, blind to each other. So you become a human clipboard — pasting Claude's plan into
Codex, Codex's diff into Gemini, and back again, at 3AM.

<div align="center">
<img src="https://raw.githubusercontent.com/aliildan/brainstorming/main/brainstroming_meme.png" alt="Developers with AI at 3AM" width="320" />
</div>

**brainstorming** puts them in the same room. One shared transcript is the source of truth. Everyone
sees every message and decision. You @-mention who should act, they can @-mention each other to
consult, and the whole group converges — with you holding the remote.

## Features

- **One shared conversation** — every agent reads the same transcript, so context is never re-pasted.
- **@-mention routing** — `@codex build the parser`, `@all what do you think?`, or just keep talking to whoever answered last (sticky targets).
- **Agent-to-agent consultation** — an agent can `@claude` another for a second opinion, bounded by a per-message **round budget** so loops can't burn your quota. Out of budget? `/continue` or let it rest.
- **Real work, with your approval** — Claude and Codex tool actions surface as a single **permission card** in the TUI; you press `i` / `o` / `r` to allow / allow-for-session / deny.
- **Persistent & resumable** — the transcript and each backend's native session are saved under `.brainstorming/`; reopen the room and everyone remembers.
- **Uses your existing logins** — no API keys. It drives the CLIs/SDKs you're already signed into.
- **`/decide`** — record a group decision to `DECISIONS.md`; it's surfaced to every agent afterwards.
- **Try it free** — `--demo` runs the whole experience with scripted agents and zero quota.

## Install

```bash
npm install -g brainstorming
```

**Prerequisites** — install and sign into the agents you want in the room (each optional; enable/disable in config):

| Agent | CLI / backend | Sign in with |
| --- | --- | --- |
| `@claude` | [`claude`](https://claude.com/claude-code) (Claude Agent SDK) | `claude` → `/login` (Pro/Max subscription) |
| `@codex` | [`codex`](https://developers.openai.com/codex) (`codex app-server`) | `codex login` (ChatGPT subscription) |
| `@antigravity` | [`agy`](https://antigravity.google) (Antigravity CLI) | Google sign-in on first run |
| `@ollama` | [`ollama`](https://ollama.com) (local or `*-cloud` models) | `ollama signin` for cloud models |

Node ≥ 20 required. No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` needed — subscriptions are used.

## Quick start

```bash
cd your-project        # a git repo (Codex needs one)
brainstorming          # opens the shared chat in the current directory
```

Try it with no setup and no quota:

```bash
brainstorming --demo
```

In the chat:

- `@all which API style should we use?` — everyone weighs in; Claude may consult Codex automatically.
- `@codex scaffold the endpoints` — delegate real work; approve its edits from the permission card.
- `@claude pingpong` (demo) — watch the round budget stop an infinite agent loop, then `/continue`.
- `/decide use versioned REST + OpenAPI` — record the call to `DECISIONS.md`.
- `/help` for all commands · `Tab` to autocomplete `@names` · `Esc` to interrupt · `/quit` to exit.

## How it works

```
        ┌──────────────── brainstorming (Ink TUI) ────────────────┐
        │   shared transcript  ·  router  ·  round-budget engine   │
        └───────────────────────────┬─────────────────────────────┘
                    one common AgentAdapter interface
        ┌───────────┬───────────────┼───────────────┬─────────────┐
     Claude       Codex         Antigravity        Ollama
  agent-sdk    app-server         agy CLI        /api/chat
  (resume)   (JSON-RPC/stdio)  (stream-json)   (client history)
```

- The **transcript** (`.brainstorming/room.jsonl`) is the single source of truth; every agent is briefed from it, so any one can be restarted and re-briefed.
- The **router** delivers each message to its `@mentioned` targets (or the previous ones), and `@all` fans out in parallel.
- The **cascade engine** lets agents mention each other, bounded by the round budget, with `/continue` and `Esc` in your hands.
- Each agent is a thin **adapter** behind one interface — streaming text, tool activity, permission requests, and session resume — so new backends slot in without touching the core.

## Configuration

A config file is created on first run at `~/.config/brainstorming/config.json`:

```json
{
  "roundBudget": 3,
  "agents": {
    "claude":      { "enabled": true },
    "codex":       { "enabled": true },
    "antigravity": { "enabled": true },
    "ollama":      { "enabled": true, "model": "qwen3.5:cloud" }
  }
}
```

Disable an agent with `"enabled": false`, pin a `model`, or add `personaExtra` to shape how one behaves in the room. If Ollama has no `model`, brainstorming auto-picks an available `*-cloud` model.

## Development

```bash
git clone https://github.com/aliildan/brainstorming.git
cd brainstorming
pnpm install
pnpm test        # unit + end-to-end tests (no quota)
pnpm typecheck
pnpm demo        # run the demo from source
```

Monorepo layout: `packages/core` (kernel), `packages/adapters` (per-agent backends), `packages/tui` (Ink UI), `apps/cli` (the `brainstorming` binary).

## License

MIT © Ali Ildan
