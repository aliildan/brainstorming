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

    // An interrupted delivery leaves a partial reply we must not commit as finished.
    if (signal.aborted) return null;
    const text = (final ?? acc).trim();
    if (!text) return null;
    const mentions = parseMentions(text, this.roster).filter((n) => n !== agentName);
    return this.#append(agentName, text, "chat", mentions);
  }
}
