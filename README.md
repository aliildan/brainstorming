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

## How it works

- **Transcript** (`packages/core`) is the append-only source of truth; every
  agent is briefed from it, so any participant can be restarted and re-briefed.
- **Router** delivers to `@mentioned` agents, falls back to the previous
  (sticky) targets, and expands `@all` to everyone.
- **Cascade engine** lets agents @-mention each other, bounded by a per-message
  round budget so loops can't burn quota; `/continue` resumes, `ESC` interrupts.
- **AgentAdapter** is the single contract each backend implements. Today a
  scripted `FakeAdapter` drives tests and the demo; Claude/Codex/Gemini/Ollama
  adapters plug into the same interface in later phases.
- **TUI** (`packages/tui`, Ink) renders finalized messages, live streaming
  blocks, per-agent status, and unified permission cards.

## Development

```bash
pnpm test        # vitest unit + end-to-end tests
pnpm typecheck   # strict TypeScript
```

Design docs live in `docs/superpowers/specs/` and plans in
`docs/superpowers/plans/`.
