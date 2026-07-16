import { randomUUID } from "node:crypto";
import {
  renderPrompt,
  type AdapterContext,
  type AgentAdapter,
  type AgentEvent,
  type PromptInput,
} from "@brainstorming/core";

/** Minimal shapes of the Claude Agent SDK messages this adapter consumes. */
interface ClaudeContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}
export type ClaudeMessage =
  | { type: "system"; subtype: string; session_id?: string }
  | { type: "assistant"; session_id?: string; message?: { content?: ClaudeContentBlock[] } }
  | { type: "result"; subtype?: string; session_id?: string; is_error?: boolean; result?: string }
  | { type: string; [k: string]: unknown };

export type ClaudePermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export type ClaudeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal },
) => Promise<ClaudePermissionResult | null>;

export interface ClaudeQueryParams {
  prompt: string;
  options: Record<string, unknown>;
}
export type ClaudeQueryFn = (params: ClaudeQueryParams) => AsyncIterable<ClaudeMessage>;

/** SDK permission mode: "default" routes tool prompts to our card via canUseTool. */
export type ClaudePermissionMode = "default" | "acceptEdits" | "plan";

export interface ClaudeOptions {
  permissionMode?: ClaudePermissionMode;
  /** Injected SDK `query` (tests). Defaults to a lazily-imported real SDK query. */
  queryFn?: ClaudeQueryFn;
}

function preview(input: unknown): string {
  try {
    return JSON.stringify(input).slice(0, 500);
  } catch {
    return String(input).slice(0, 500);
  }
}

/**
 * Drives Claude Code via `@anthropic-ai/claude-agent-sdk`.
 *
 * Each turn is one `query()` with `resume: <sessionId>` after the first turn,
 * so context persists across process restarts on the user's subscription (no
 * API key). Tool-permission prompts route to our TUI via `canUseTool`.
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly capabilities = { tools: true, steering: false, resume: true };

  #sessionId?: string;
  #cwd = process.cwd();
  #persona = "";
  readonly #permissionMode: ClaudePermissionMode;
  readonly #query: ClaudeQueryFn;

  constructor(
    readonly name = "claude",
    opts: ClaudeOptions = {},
  ) {
    this.#permissionMode = opts.permissionMode ?? "default";
    this.#query = opts.queryFn ?? this.#defaultQuery;
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  #defaultQuery: ClaudeQueryFn = async function* (params) {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    // The SDK's Options type is broad; we pass through the fields we set.
    const q = query({ prompt: params.prompt, options: params.options as never });
    for await (const message of q) yield message as ClaudeMessage;
  };

  async start(ctx: AdapterContext): Promise<void> {
    this.#cwd = ctx.workspaceDir;
    this.#persona = ctx.persona;
    this.#sessionId = ctx.savedSessionId ?? this.#sessionId;
  }

  async interrupt(): Promise<void> {
    // Interruption is driven by the AbortSignal passed to prompt(); nothing to do here.
  }

  async stop(): Promise<string | undefined> {
    return this.#sessionId;
  }

  async *prompt(input: PromptInput, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const promptText = renderPrompt(input);
    const queue: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let final: string | null = null;
    let errored = false;

    const push = (ev: AgentEvent) => {
      queue.push(ev);
      wake?.();
      wake = null;
    };

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal.aborted) ac.abort();
    else signal.addEventListener("abort", onAbort, { once: true });

    const canUseTool: ClaudeCanUseTool = (toolName, toolInput) => {
      if (ac.signal.aborted) return Promise.resolve({ behavior: "deny", message: "aborted" });
      return new Promise((resolve) => {
        push({
          type: "permission-request",
          request: { id: randomUUID(), agent: this.name, action: `use ${toolName}`, preview: preview(toolInput) },
          respond: (d) =>
            resolve(
              d === "deny"
                ? { behavior: "deny", message: "Denied by the user." }
                : { behavior: "allow", updatedInput: toolInput },
            ),
        });
      });
    };

    const run = async () => {
      try {
        const q = this.#query({
          prompt: promptText,
          options: {
            resume: this.#sessionId,
            cwd: this.#cwd,
            // Persona rides on the first turn; the resumed session already has it.
            systemPrompt: this.#sessionId
              ? undefined
              : { type: "preset", preset: "claude_code", append: this.#persona },
            permissionMode: this.#permissionMode,
            canUseTool,
            settingSources: ["project"],
            abortController: ac,
          },
        });
        for await (const msg of q) {
          if (msg.type === "system" && (msg as { subtype?: string }).subtype === "init") {
            const id = (msg as { session_id?: string }).session_id;
            if (id) this.#sessionId = id;
          } else if (msg.type === "assistant") {
            const m = msg as { session_id?: string; message?: { content?: ClaudeContentBlock[] } };
            if (m.session_id) this.#sessionId = m.session_id;
            for (const block of m.message?.content ?? []) {
              if (block.type === "text" && block.text) push({ type: "text-delta", text: block.text });
              else if (block.type === "tool_use")
                push({ type: "activity", activity: { kind: "tool", title: block.name ?? "tool", status: "running" } });
            }
          } else if (msg.type === "result") {
            const r = msg as { session_id?: string; is_error?: boolean; subtype?: string; result?: string };
            if (r.session_id) this.#sessionId = r.session_id;
            if (r.is_error || (r.subtype && r.subtype !== "success")) {
              errored = true;
              if (!ac.signal.aborted)
                push({ type: "error", error: { message: r.result || r.subtype || "claude error", fatal: false } });
            } else if (typeof r.result === "string") {
              final = r.result;
            }
          }
        }
      } catch (err) {
        errored = true;
        if (!ac.signal.aborted) push({ type: "error", error: { message: String(err), fatal: false } });
      } finally {
        finished = true;
        wake?.();
        wake = null;
      }
    };
    const runPromise = run();

    try {
      while (true) {
        while (queue.length) yield queue.shift()!;
        if (finished) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      while (queue.length) yield queue.shift()!;
      if (!ac.signal.aborted && !errored && final !== null) yield { type: "done", finalText: final };
    } finally {
      signal.removeEventListener("abort", onAbort);
      await runPromise.catch(() => {});
    }
  }
}
