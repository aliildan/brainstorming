/** Message author: the human user, the system, or an agent name from the roster. */
export type Author = "user" | "system" | (string & {});

export type MessageKind = "chat" | "activity" | "permission" | "system";

export interface ChatMessage {
  id: string;
  ts: number; // epoch ms
  author: Author;
  content: string;
  /** Roster names this message addresses (already resolved, no "@" prefix, no "all"). */
  mentions: string[];
  kind: MessageKind;
}

export interface ToolActivity {
  kind: "command" | "file-change" | "tool";
  title: string; // e.g. `ran: pnpm test`
  detail?: string;
  status: "running" | "ok" | "failed";
}

export interface PermissionRequest {
  id: string;
  agent: string;
  action: string; // e.g. "run command"
  preview: string; // command line or diff
}

export type PermissionDecision = "allow-once" | "allow-session" | "deny";

export interface QuotaInfo {
  usedPercent?: number;
  resetsAt?: string;
  note?: string;
}

export interface AdapterError {
  message: string;
  fatal: boolean;
}

export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "activity"; activity: ToolActivity }
  | {
      type: "permission-request";
      request: PermissionRequest;
      respond: (decision: PermissionDecision) => void;
    }
  | { type: "usage"; info: QuotaInfo }
  | { type: "done"; finalText: string }
  | { type: "error"; error: AdapterError };

export interface PromptInput {
  /** Messages the agent has not seen yet, excluding the addressed message and its own. */
  digest: ChatMessage[];
  /** The message that triggered this prompt. */
  addressed: ChatMessage;
}

export interface AdapterContext {
  workspaceDir: string;
  /** Rendered persona / group-chat protocol text for this participant. */
  persona: string;
  /** Native session/thread id saved in room.json, when resuming. */
  savedSessionId?: string;
  /**
   * Prior transcript when resuming a room. Client-managed adapters (e.g. Ollama)
   * rebuild their history from this; server-session adapters ignore it.
   */
  transcript?: readonly ChatMessage[];
}

export interface AgentAdapter {
  readonly name: string;
  readonly capabilities: { tools: boolean; steering: boolean; resume: boolean };
  start(ctx: AdapterContext): Promise<void>;
  prompt(input: PromptInput, signal: AbortSignal): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  /** Graceful shutdown; returns the native session id to persist, if any. */
  stop(): Promise<string | undefined>;
}
