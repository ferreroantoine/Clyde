import { z } from 'zod'

export type MemoryScope = 'user' | 'project'

export interface MemoryDocView {
  name: string
  title: string
  content: string
}

export interface MemoryPart {
  dir: string
  core: string
  docs: MemoryDocView[]
  /** Estimated tokens of the core, loaded in every session. */
  tokens: number
}

export interface MemoryProposal {
  id: string
  scope: MemoryScope
  projectRoot: string | null
  sessionId: string | null
  /** From a finished session, or from "Consolidate the memory". */
  kind: 'session' | 'consolidate'
  before: string
  after: string
  reason: string
  createdAt: number
}

export interface MemoryState {
  /** Settings › Memory & context: tokens the cores may use together. */
  budget: number
  user: MemoryPart
  project: (MemoryPart & { root: string }) | null
  proposals: MemoryProposal[]
  /** Set after a save that masked something shaped like a credential. */
  redacted?: boolean
}

const scope = z.enum(['user', 'project'])

export const memorySaveCoreSchema = z.object({ scope, text: z.string().max(200_000) })
export const memorySaveDocSchema = z.object({
  scope,
  /** Existing file name, or null for a new note named after its title. */
  name: z.string().regex(/^[\w.-]+\.md$/).nullable(),
  title: z.string().trim().min(1).max(120),
  content: z.string().max(500_000)
})

export type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string }

/** A line diff (longest common subsequence), for reviewing memory proposals. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  // Flat table: lcs[i * (m + 1) + j] is the common length of a[i..] and b[j..].
  const w = m + 1
  const lcs = new Array<number>((n + 1) * w).fill(0)
  const at = (i: number, j: number) => lcs[i * w + j] as number
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] as string })
      i++
      j++
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ kind: 'remove', text: a[i++] as string })
    } else {
      out.push({ kind: 'add', text: b[j++] as string })
    }
  }
  while (i < n) out.push({ kind: 'remove', text: a[i++] as string })
  while (j < m) out.push({ kind: 'add', text: b[j++] as string })
  return out
}
