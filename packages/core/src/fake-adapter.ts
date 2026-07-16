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
