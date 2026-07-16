/** Mentions always win; un-mentioned messages continue with the previous (sticky) targets. */
export function resolveTargets(args: { mentions: string[]; sticky: string[] }): string[] {
  if (args.mentions.length > 0) return [...args.mentions];
  return [...args.sticky];
}
