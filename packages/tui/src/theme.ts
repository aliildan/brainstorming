const PALETTE = ["yellow", "green", "blue", "magenta", "red", "white"] as const;

/** Stable color per author: user is cyan, system gray, agents from the palette. */
export function authorColor(name: string): string {
  if (name === "user") return "cyan";
  if (name === "system") return "gray";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
