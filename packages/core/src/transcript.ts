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
