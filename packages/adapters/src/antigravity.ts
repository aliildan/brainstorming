import { spawn as nodeSpawn } from "node:child_process";
import readline from "node:readline";
import { Readable } from "node:stream";
import {
  renderPrompt,
  type AdapterContext,
  type AgentAdapter,
  type AgentEvent,
  type PromptInput,
} from "@brainstorming/core";

/**
 * The subset of a spawned `agy` process this adapter relies on.
 * Real runs use node's child_process; tests inject a scripted fake.
 */
export interface AgyChild {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on(event: "close", listener: (code: number | null) => void): void;
  kill(signal?: NodeJS.Signals): void;
}

export type SpawnAgy = (args: string[], opts: { cwd: string }) => AgyChild;

/**
 * How much autonomy the agy process has over tool use in headless mode.
 * agy has no interactive permission event on its JSON stream, so a chat
 * participant runs in one of these preset modes rather than per-tool prompts.
 * - "accept-edits": auto-approve file edits, still soft-deny risky commands (default)
 * - "sandbox-auto": sandboxed, auto-approve everything (`--sandbox --dangerously-skip-permissions`)
 * - "plan": read-only planning, no edits
 */
export type AntigravityPermissionMode = "accept-edits" | "sandbox-auto" | "plan";

export interface AntigravityOptions {
  /** Exact `agy models` display string, e.g. "Gemini 3.1 Pro (High)". Omit to use agy's own default. */
  model?: string;
  permissionMode?: AntigravityPermissionMode;
  /** Path to the agy binary (default: env AGY_BIN, else "agy" on PATH). */
  binPath?: string;
  /** Per-turn wall-clock budget passed to `--print-timeout` (default "30m"). */
  printTimeout?: string;
  /** Injected process spawner (tests). Defaults to a real child_process spawn. */
  spawn?: SpawnAgy;
}

interface AgyResultPayload {
  conversation_id?: string;
  status?: "SUCCESS" | "ERROR" | "CANCELLED" | string;
  response?: string;
  error?: string;
}

/**
 * Drives Google Antigravity's `agy` CLI as a persistent, stateful chat participant.
 *
 * Each turn spawns `agy --print --output-format stream-json`. The server-assigned
 * `conversation_id` is captured on the first turn and replayed via `--conversation`
 * on every later turn, so full history persists (in agy's on-disk SQLite) across
 * process restarts — the app only sends the per-turn digest each time.
 */
export class AntigravityAdapter implements AgentAdapter {
  readonly capabilities = { tools: true, steering: false, resume: true };

  #conversationId?: string;
  #cwd = process.cwd();
  #persona = "";
  #child: AgyChild | null = null;
  readonly #bin: string;
  readonly #model?: string;
  readonly #permissionMode: AntigravityPermissionMode;
  readonly #printTimeout: string;
  readonly #spawn: SpawnAgy;

  constructor(
    readonly name = "antigravity",
    opts: AntigravityOptions = {},
  ) {
    this.#bin = opts.binPath ?? process.env.AGY_BIN ?? "agy";
    this.#model = opts.model;
    this.#permissionMode = opts.permissionMode ?? "accept-edits";
    this.#printTimeout = opts.printTimeout ?? "30m";
    this.#spawn = opts.spawn ?? this.#defaultSpawn;
  }

  /** The captured conversation id, once a turn has run (persist to resume later). */
  get sessionId(): string | undefined {
    return this.#conversationId;
  }

  #defaultSpawn: SpawnAgy = (args, opts) => {
    // stderr is discarded, not surfaced: agy logs there and inheriting/printing
    // it would corrupt the Ink TUI. Real failures arrive as `result` events with
    // status ERROR on stdout, or a non-zero exit handled by the reader.
    const child = nodeSpawn(this.#bin, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "ignore"],
      env: process.env,
    });
    if (!child.stdout) throw new Error("agy: stdout pipe unavailable");
    return {
      stdout: child.stdout,
      stderr: child.stderr ?? new Readable({ read() {} }),
      on: (event, listener) => child.on(event, listener),
      kill: (signal) => void child.kill(signal),
    };
  };

  async start(ctx: AdapterContext): Promise<void> {
    this.#cwd = ctx.workspaceDir;
    this.#persona = ctx.persona;
    // Resume a prior conversation across app restarts when one was saved.
    this.#conversationId = ctx.savedSessionId ?? this.#conversationId;
  }

  async interrupt(): Promise<void> {
    this.#child?.kill("SIGTERM");
  }

  async stop(): Promise<string | undefined> {
    this.#child?.kill("SIGTERM");
    this.#child = null;
    return this.#conversationId;
  }

  #buildArgs(promptText: string): string[] {
    const args = ["--output-format", "stream-json", "--print-timeout", this.#printTimeout];
    if (this.#model) args.push("--model", this.#model);
    args.push("--add-dir", this.#cwd);
    if (this.#permissionMode === "sandbox-auto") args.push("--sandbox", "--dangerously-skip-permissions");
    else if (this.#permissionMode === "plan") args.push("--mode", "plan");
    else args.push("--mode", "accept-edits");
    if (this.#conversationId) args.push("--conversation", this.#conversationId);
    // `-p`/`--print` is a STRING flag: the prompt is its value, not a trailing
    // positional (otherwise `--print` swallows the next flag). Keep it last.
    args.push("-p", promptText);
    return args;
  }

  async *prompt(input: PromptInput, signal: AbortSignal): AsyncIterable<AgentEvent> {
    // Persona is only sent on the first turn; afterwards it lives in the persisted conversation.
    const base = renderPrompt(input);
    const promptText = this.#conversationId || !this.#persona ? base : `${this.#persona}\n\n${base}`;

    const child = this.#spawn(this.#buildArgs(promptText), { cwd: this.#cwd });
    this.#child = child;

    const queue: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let closeCode: number | null = null;
    let sawResult = false;

    const push = (ev: AgentEvent) => {
      queue.push(ev);
      wake?.();
      wake = null;
    };

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: { event?: string; conversation_id?: string; step_update?: Record<string, unknown>; result?: AgyResultPayload };
      try {
        ev = JSON.parse(trimmed);
      } catch {
        return; // tolerate non-JSON log noise on the stream
      }
      switch (ev.event) {
        case "init":
          if (ev.conversation_id) this.#conversationId = ev.conversation_id;
          break;
        case "step_update": {
          const s = ev.step_update ?? {};
          const stepType = s.step_type as string | undefined;
          if (stepType === "agent_response" && typeof s.text_delta === "string" && s.text_delta) {
            push({ type: "text-delta", text: s.text_delta });
          } else if (stepType === "tool_call") {
            push({
              type: "activity",
              activity: {
                kind: "tool",
                title: (s.tool_name as string) ?? "tool call",
                status: s.state === "DONE" ? "ok" : "running",
              },
            });
          }
          break;
        }
        case "result": {
          const r = ev.result ?? {};
          sawResult = true;
          if (r.conversation_id) this.#conversationId = r.conversation_id;
          if (r.status === "SUCCESS") {
            push({ type: "done", finalText: r.response ?? "" });
          } else {
            push({
              type: "error",
              error: { message: r.error || r.status || "antigravity error", fatal: false },
            });
          }
          break;
        }
      }
    });

    child.on("close", (code) => {
      closeCode = code;
    });
    rl.on("close", () => {
      finished = true;
      wake?.();
      wake = null;
    });

    const onAbort = () => child.kill("SIGTERM");
    if (signal.aborted) child.kill("SIGTERM");
    else signal.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        while (queue.length) yield queue.shift()!;
        if (finished) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      while (queue.length) yield queue.shift()!;
      if (!sawResult && !signal.aborted) {
        yield {
          type: "error",
          error: { message: `agy exited (code ${closeCode ?? "unknown"}) with no result`, fatal: false },
        };
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      rl.close();
      this.#child = null;
    }
  }
}
