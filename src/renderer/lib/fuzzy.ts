/**
 * Subsequence match with a score: consecutive letters, word starts and an early first match
 * rank higher. Returns null when `query` is not a subsequence of `text` (case-insensitive).
 */
export function fuzzyScore(query: string, text: string): { score: number; positions: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return { score: 0, positions: [] }
  const t = text.toLowerCase()
  let best: { score: number; positions: number[] } | null = null
  // Greedy matching from each occurrence of the first letter; keep the best run.
  for (let start = t.indexOf(q[0] ?? ''); start >= 0; start = t.indexOf(q[0] ?? '', start + 1)) {
    const run = matchFrom(q, text, t, start)
    if (run && (!best || run.score > best.score)) best = run
  }
  return best
}

function matchFrom(q: string, text: string, t: string, start: number): { score: number; positions: number[] } | null {
  const positions: number[] = []
  let score = 0
  let from = start
  let previous = -2
  for (const ch of q) {
    const index = t.indexOf(ch, from)
    if (index < 0) return null
    const boundary = index === 0 || /[\s/\\._\-:›]/.test(text[index - 1] ?? '')
    score += 1 + (index === previous + 1 ? 3 : 0) + (boundary ? 2 : 0)
    positions.push(index)
    previous = index
    from = index + 1
  }
  // Prefer shorter texts and matches that start early.
  score -= (positions[0] ?? 0) * 0.05 + text.length * 0.01
  return { score, positions }
}

/** Items that match, best first; ties keep their original order. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string, limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit)
  return items
    .map((item, i) => ({ item, i, m: fuzzyScore(query, text(item)) }))
    .filter((x): x is { item: T; i: number; m: { score: number; positions: number[] } } => x.m !== null)
    .sort((a, b) => b.m.score - a.m.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item)
}
