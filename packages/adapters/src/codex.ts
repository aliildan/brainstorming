import { spawn } from "node:child_process";
import readline from "node:readline";
import {
  renderPrompt,
  type AdapterContext,
  type AgentAdapter,
  type AgentEvent,
  type PermissionDecision,
  type PromptInput,
} from "@brainstorming/core";

type Json = Record<string, unknown>;

/** Newline-delimited JSON-RPC 2.0 channel to a `codex app-server` process. */
export interface CodexTransport {
  send(message: Json): void;
  onMessage(cb: (msg: Json) => void): void;
  close(): void;
}
export type CodexConnect = (opts: { cwd: string }) => CodexTransport;

/** codex approval policy for the thread. "on-request" routes prompts to our card. */
export type CodexApprovalPolicy = "untrusted" | "on-request" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexOptions {
  model?: string;
  approvalPolicy?: CodexApprovalPolicy;
  sandbox?: CodexSandboxMode;
  /** Path to the codex binary (default: env CODEX_BIN, else "codex"). */
  binPath?: string;
  /** Injected transport (tests). Defaults to spawning `codex app-server`. */
  connect?: CodexConnect;
}

interface TurnSink {
  push: (ev: AgentEvent) => void;
  onNotification: (method: string, params: Json) => void;
}

const DECISION_MAP: Record<PermissionDecision, string> = {
  "allow-once": "accept",
  "allow-session": "acceptForSession",
  deny: "decline",
};

/**
 * Drives OpenAI Codex via a long-lived `codex app-server` (JSON-RPC 2.0 over
 * stdio) — the interface the official IDE extension uses.
 *
 * The app-server hosts a persistent thread: `thread/start` (persona via
 * `developerInstructions`) on first run, `thread/resume` across restarts. Each
 * `prompt()` is one `turn/start`; agent text streams via `item/agentMessage/delta`,
 * tool work via `item/*` items, and command/file approvals route to our card.
 */
export class CodexAdapter implements AgentAdapter {
  readonly capabilities = { tools: true, steering: true, resume: true };

  #cwd = process.cwd();
  #persona = "";
  #threadId?: string;
  #transport: CodexTransport | null = null;
  #nextId = 0;
  #pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  #turn: TurnSink | null = null;
  readonly #bin: string;
  readonly #model?: string;
  readonly #approvalPolicy: CodexApprovalPolicy;
  readonly #sandbox: CodexSandboxMode;
  readonly #connect: CodexConnect;

  constructor(
    readonly name = "codex",
    opts: CodexOptions = {},
  ) {
    this.#bin = opts.binPath ?? process.env.CODEX_BIN ?? "codex";
    this.#model = opts.model;
    this.#approvalPolicy = opts.approvalPolicy ?? "on-request";
    this.#sandbox = opts.sandbox ?? "workspace-write";
    this.#connect = opts.connect ?? this.#defaultConnect;
  }

  get sessionId(): string | undefined {
    return this.#threadId;
  }

  #defaultConnect: CodexConnect = ({ cwd }) => {
    const child = spawn(this.#bin, ["app-server"], { cwd, stdio: ["pipe", "pipe", "inherit"], env: process.env });
    const rl = readline.createInterface({ input: child.stdout! });
    return {
      send: (message) => child.stdin!.write(JSON.stringify(message) + "\n"),
      onMessage: (cb) =>
        rl.on("line", (line) => {
          const t = line.trim();
          if (!t) return;
          try {
            cb(JSON.parse(t) as Json);
          } catch {
            /* ignore non-JSON log noise */
          }
        }),
      close: () => child.kill("SIGTERM"),
    };
  };

  #request(method: string, params: Json): Promise<Json> {
    const id = ++this.#nextId;
    this.#transport!.send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  #notify(method: string, params: Json): void {
    this.#transport!.send({ jsonrpc: "2.0", method, params });
  }

  #respond(id: number, result: Json): void {
    this.#transport!.send({ jsonrpc: "2.0", id, result });
  }

  #handleMessage(msg: Json): void {
    const method = msg.method as string | undefined;
    const id = msg.id as number | undefined;
    if (method && id !== undefined) {
      this.#handleServerRequest(id, method, (msg.params as Json) ?? {});
    } else if (id !== undefined) {
      const p = this.#pending.get(id);
      if (!p) return;
      this.#pending.delete(id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve((msg.result as Json) ?? {});
    } else if (method) {
      this.#turn?.onNotification(method, (msg.params as Json) ?? {});
    }
  }

  #handleServerRequest(id: number, method: string, params: Json): void {
    const isApproval = method.endsWith("requestApproval");
    if (isApproval && this.#turn) {
      const preview =
        method.includes("command")
          ? (params.command as string) ?? JSON.stringify(params).slice(0, 300)
          : JSON.stringify(params.changes ?? params).slice(0, 300);
      this.#turn.push({
        type: "permission-request",
        request: {
          id: String(id),
          agent: this.name,
          action: method.includes("command") ? "run command" : "edit files",
          preview: String(preview),
        },
        respond: (d) => this.#respond(id, { decision: DECISION_MAP[d] }),
      });
    } else {
      // Unknown/unhandled server request: decline so the turn does not hang.
      this.#respond(id, isApproval ? { decision: "decline" } : {});
    }
  }

  async start(ctx: AdapterContext): Promise<void> {
    this.#cwd = ctx.workspaceDir;
    this.#persona = ctx.persona;
    this.#threadId = ctx.savedSessionId ?? this.#threadId;
    this.#transport = this.#connect({ cwd: this.#cwd });
    this.#transport.onMessage((msg) => this.#handleMessage(msg));

    await this.#request("initialize", {
      clientInfo: { name: "brainstorming", title: "brainstorming", version: "0.1.0" },
      capabilities: null,
    });
    this.#notify("initialized", {});

    if (this.#threadId) {
      try {
        await this.#request("thread/resume", { threadId: this.#threadId });
        return;
      } catch {
        this.#threadId = undefined; // fall through to a fresh thread
      }
    }
    const params: Json = {
      cwd: this.#cwd,
      approvalPolicy: this.#approvalPolicy,
      sandbox: this.#sandbox,
      developerInstructions: this.#persona,
    };
    if (this.#model) params.model = this.#model;
    const res = await this.#request("thread/start", params);
    this.#threadId = (res.thread as Json | undefined)?.id as string | undefined;
  }

  async interrupt(): Promise<void> {
    if (this.#threadId) await this.#request("turn/interrupt", { threadId: this.#threadId }).catch(() => {});
  }

  async stop(): Promise<string | undefined> {
    this.#transport?.close();
    this.#transport = null;
    return this.#threadId;
  }

  async *prompt(input: PromptInput, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const queue: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let errored = false;
    let final = "";

    const push = (ev: AgentEvent) => {
      queue.push(ev);
      wake?.();
      wake = null;
    };

    const onNotification = (method: string, params: Json) => {
      switch (method) {
        case "item/agentMessage/delta":
          push({ type: "text-delta", text: String(params.delta ?? "") });
          break;
        case "item/completed": {
          const item = params.item as Json | undefined;
          const type = item?.type as string | undefined;
          if (type === "agentMessage") final = String(item?.text ?? final);
          else if (type === "commandExecution")
            push({
              type: "activity",
              activity: {
                kind: "command",
                title: `ran: ${String(item?.command ?? "command")}`,
                status: item?.exitCode === 0 ? "ok" : item?.exitCode == null ? "running" : "failed",
              },
            });
          else if (type === "fileChange")
            push({ type: "activity", activity: { kind: "file-change", title: "edited files", status: "ok" } });
          break;
        }
        case "error":
          errored = true;
          push({ type: "error", error: { message: String(params.message ?? "codex error"), fatal: false } });
          finished = true;
          wake?.();
          break;
        case "turn/completed":
          finished = true;
          wake?.();
          break;
      }
    };

    this.#turn = { push, onNotification };
    const onAbort = () => void this.interrupt();
    if (signal.aborted) void this.interrupt();
    else signal.addEventListener("abort", onAbort, { once: true });

    const text = renderPrompt(input);
    this.#request("turn/start", {
      threadId: this.#threadId,
      input: [{ type: "text", text, text_elements: [] }],
    }).catch((err: Error) => {
      errored = true;
      push({ type: "error", error: { message: err.message, fatal: false } });
      finished = true;
      wake?.();
    });

    try {
      while (true) {
        while (queue.length) yield queue.shift()!;
        if (finished) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      while (queue.length) yield queue.shift()!;
      if (!signal.aborted && !errored) yield { type: "done", finalText: final };
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.#turn = null;
    }
  }
}
