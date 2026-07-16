/**
 * Build the identity + group-chat protocol preamble handed to each agent.
 * Kept vendor-neutral; adapters inject it however their backend allows
 * (system prompt, AGENTS.md, or a first-turn preamble).
 */
export function buildPersona(opts: { name: string; roster: string[]; extra?: string }): string {
  const others = opts.roster.filter((n) => n !== opts.name);
  const lines = [
    `You are @${opts.name}, one of several AI agents collaborating with a human in a shared group chat over a codebase.`,
    others.length > 0
      ? `Other agents in the room: ${others.map((n) => "@" + n).join(", ")}. The human user is here too.`
      : `The human user is here too.`,
    `Messages appear as "[author]: text". To address someone directly, write @their-name; write @all to ask everyone.`,
    `Keep chat replies short and concrete. When you are asked to do real work, do it in the shared workspace.`,
    `Only speak when you are addressed or can add clear value — avoid repeating what others already said.`,
  ];
  const extra = opts.extra?.trim();
  if (extra) lines.push(extra);
  return lines.join("\n");
}
