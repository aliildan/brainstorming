import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TranscriptStore } from "./transcript.js";

export interface RoomParticipant {
  name: string;
  /** Native backend session/thread id, when the adapter reported one. */
  sessionId?: string;
}

export interface RoomMeta {
  participants: RoomParticipant[];
  roundBudget: number;
}

/**
 * Owns a room's on-disk state under `<workspace>/.brainstorming/`:
 * `room.jsonl` (append-only transcript) + `room.json` (participants + settings).
 */
export class RoomStore {
  #dir: string;

  constructor(workspaceDir: string) {
    this.#dir = join(workspaceDir, ".brainstorming");
    mkdirSync(this.#dir, { recursive: true });
  }

  get dir(): string {
    return this.#dir;
  }
  get transcriptPath(): string {
    return join(this.#dir, "room.jsonl");
  }
  get metaPath(): string {
    return join(this.#dir, "room.json");
  }
  get exists(): boolean {
    return existsSync(this.metaPath);
  }

  loadTranscript(): TranscriptStore {
    return TranscriptStore.load(this.transcriptPath);
  }

  loadMeta(): RoomMeta | null {
    if (!existsSync(this.metaPath)) return null;
    try {
      return JSON.parse(readFileSync(this.metaPath, "utf8")) as RoomMeta;
    } catch {
      return null;
    }
  }

  saveMeta(meta: RoomMeta): void {
    writeFileSync(this.metaPath, JSON.stringify(meta, null, 2) + "\n");
  }
}
