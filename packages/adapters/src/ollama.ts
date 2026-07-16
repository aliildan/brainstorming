import {
  type AdapterContext,
  type AgentAdapter,
  type AgentEvent,
  type ChatMessage,
  type PromptInput,
} from "@brainstorming/core";

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatChunk {
  message?: { content?: string };
  done?: boolean;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: true;
}

/** The subset of the `ollama` npm client this adapter needs. */
export interface OllamaClientLike {
  chat(req: OllamaChatRequest): Promise<AsyncIterable<OllamaChatChunk>>;
  abort(): void;
}

export interface OllamaOptions {
  /** Exact model tag, e.g. "qwen3.5:cloud". Required — no baked-in default. */
  model: string;
  /** Ollama host (default http://127.0.0.1:11434); ignored when `client` is injected. */
  host?: string;
  /** Injected client (tests). Defaults to a real `ollama` client. */
  client?: OllamaClientLike;
}

/**
 * A chat-only participant backed by an Ollama model (local or `*-cloud`).
 *
 * Ollama has no server-side session, so the adapter owns the message history:
 * it is rebuilt from `ctx.transcript` on resume and grown each turn. Turns are
 * serialized internally because the Ollama free tier allows one concurrent
 * cloud model. This adapter gives opinions; it has no file/command tools.
 */
export class OllamaAdapter implements AgentAdapter {
  readonly capabilities = { tools: false, steering: false, resume: true };

  #history: OllamaMessage[] = [];
  #model: string;
  #host?: string;
  #clientOverride?: OllamaClientLike;
  #client: OllamaClientLike | null = null;
  #lock: Promise<void> = Promise.resolve();

  constructor(
    readonly name = "ollama",
    opts: OllamaOptions = { model: "" },
  ) {
    this.#model = opts.model;
    this.#host = opts.host;
    this.#clientOverride = opts.client;
  }

  async start(ctx: AdapterContext): Promise<void> {
    if (this.#clientOverride) {
      this.#client = this.#clientOverride;
    } else {
      const { Ollama } = await import("ollama");
      this.#client = new Ollama({ host: this.#host ?? "http://127.0.0.1:11434" }) as OllamaClientLike;
    }
    this.#history = ctx.persona ? [{ role: "system", content: ctx.persona }] : [];
    for (const m of ctx.transcript ?? []) this.#history.push(this.#toMessage(m));
  }

  async interrupt(): Promise<void> {
    this.#client?.abort();
  }

  async stop(): Promise<string | undefined> {
    return undefined; // no server-side session to persist
  }

  #toMessage(m: ChatMessage): OllamaMessage {
    return m.author === this.name
      ? { role: "assistant", content: m.content }
      : { role: "user", content: `[${m.author}]: ${m.content}` };
  }

  async *prompt(input: PromptInput, signal: AbortSignal): AsyncIterable<AgentEvent> {
    // Serialize turns: the free tier permits one concurrent cloud model.
    const previous = this.#lock;
    let release!: () => void;
    this.#lock = new Promise((r) => (release = r));
    await previous;

    try {
      if (!this.#client) throw new Error("OllamaAdapter.start was not called");
      for (const m of input.digest) this.#history.push(this.#toMessage(m));
      this.#history.push(this.#toMessage(input.addressed));

      const onAbort = () => this.#client?.abort();
      if (signal.aborted) return;
      signal.addEventListener("abort", onAbort, { once: true });

      let acc = "";
      try {
        const stream = await this.#client.chat({
          model: this.#model,
          messages: [...this.#history], // snapshot: history keeps growing after this call
          stream: true,
        });
        for await (const chunk of stream) {
          if (signal.aborted) break;
          const text = chunk.message?.content ?? "";
          if (text) {
            acc += text;
            yield { type: "text-delta", text };
          }
        }
      } catch (err) {
        if (!signal.aborted) yield { type: "error", error: { message: String(err), fatal: false } };
        return;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }

      if (signal.aborted) return;
      this.#history.push({ role: "assistant", content: acc });
      yield { type: "done", finalText: acc };
    } finally {
      release();
    }
  }
}
