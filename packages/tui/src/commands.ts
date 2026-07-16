export type Command =
  | { kind: "message"; content: string }
  | { kind: "quit" }
  | { kind: "continue" }
  | { kind: "budget"; n: number }
  | { kind: "decide"; text: string }
  | { kind: "help" }
  | { kind: "unknown"; name: string };

export function parseCommand(line: string): Command {
  if (!line.startsWith("/")) return { kind: "message", content: line };
  const [name, ...rest] = line.slice(1).split(/\s+/);
  switch (name) {
    case "quit":
      return { kind: "quit" };
    case "continue":
      return { kind: "continue" };
    case "help":
      return { kind: "help" };
    case "decide": {
      const text = rest.join(" ").trim();
      if (text) return { kind: "decide", text };
      return { kind: "unknown", name: "decide" };
    }
    case "budget": {
      const n = Number(rest[0]);
      if (Number.isInteger(n) && n > 0) return { kind: "budget", n };
      return { kind: "unknown", name: "budget" };
    }
    default:
      return { kind: "unknown", name };
  }
}

export const HELP_TEXT =
  "commands: /decide <text> /continue /budget N /help /quit — mention with @name or @all; ESC interrupts";
