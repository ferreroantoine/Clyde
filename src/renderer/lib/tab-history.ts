/**
 * Which editor tab was looked at last, so closing the current one goes back to the previous one,
 * as in VS Code. The history is most recent last and only holds open tabs.
 */
export function visit(history: readonly string[], path: string): string[] {
  return [...history.filter((p) => p !== path), path]
}

/** The tab to show after `closed` goes: the one viewed before it, else a neighbour, else none. */
export function afterClose(history: readonly string[], tabs: readonly string[], closed: string, active: string | null): string | null {
  const rest = tabs.filter((p) => p !== closed)
  if (active !== closed) return active && rest.includes(active) ? active : (rest.at(-1) ?? null)
  const previous = history.filter((p) => p !== closed && rest.includes(p)).at(-1)
  if (previous) return previous
  const index = tabs.indexOf(closed)
  return rest[index] ?? rest[index - 1] ?? null
}

/** The folders to expand so a file shows in the tree: "a/b/c.ts" → ["a", "a/b"]. */
export function ancestors(path: string): string[] {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}
