import type { ChatMessage, PromptInput } from "./types.js";

export function formatLine(msg: ChatMessage): string {
  return `[${msg.author}]: ${msg.content}`;
}

/** Render the uniform text protocol delivered to every agent. */
export function renderPrompt(input: PromptInput): string {
  const lines: string[] = [];
  if (input.digest.length > 0) {
    lines.push("[Chat since your last turn]");
    for (const m of input.digest) lines.push(formatLine(m));
    lines.push("---");
  }
  lines.push("[You are addressed]");
  lines.push(formatLine(input.addressed));
  return lines.join("\n");
}
