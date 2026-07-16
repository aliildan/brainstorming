const MENTION_RE = /@([a-z0-9][a-z0-9._:-]*)/gi;

export const ALL_MENTION = "all";

/**
 * Extract roster mentions from a message. `@all` expands to the full roster.
 * Returns lowercase names in first-mention order, deduped.
 */
export function parseMentions(content: string, roster: string[]): string[] {
  const known = new Set(roster.map((n) => n.toLowerCase()));
  const found: string[] = [];
  for (const match of content.matchAll(MENTION_RE)) {
    const name = match[1].toLowerCase();
    if (name === ALL_MENTION) return [...roster];
    if (known.has(name) && !found.includes(name)) found.push(name);
  }
  return found;
}
