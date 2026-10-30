import type { GitBranch, GitCommit, GitFileChange, GitFileState, GitHunk, GitStash, GitStatus } from '@shared/git'

/** Field and record separators of the `--format` strings below. */
export const FS = '\x1f'
export const RS = '\x1e'

const STATE: Record<string, GitFileState> = {
  M: 'modified',
  T: 'type-changed',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied'
}

export type ParsedStatus = Pick<GitStatus, 'branch' | 'head' | 'upstream' | 'ahead' | 'behind' | 'staged' | 'unstaged' | 'untracked' | 'conflicts' | 'truncated'>

/** Parses `git status --porcelain=v2 -z --branch`. Paths are relative to the repository root. */
export function parseStatus(out: string, maxEntries = 5000): ParsedStatus {
  const status: ParsedStatus = { branch: null, head: null, upstream: null, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], conflicts: [], truncated: false }
  const entries = out.split('\0')
  let count = 0
  const add = (list: GitFileChange[], change: GitFileChange) => {
    if (count++ >= maxEntries) status.truncated = true
    else list.push(change)
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? ''
    if (!entry) continue
    if (entry.startsWith('# ')) {
      const [, key, ...rest] = entry.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') status.head = value === '(initial)' ? null : value
      else if (key === 'branch.head') status.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') status.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          status.ahead = Number(m[1])
          status.behind = Number(m[2])
        }
      }
      continue
    }
    const kind = entry[0]
    if (kind === '?') {
      add(status.untracked, { path: entry.slice(2), oldPath: null, state: 'untracked' })
    } else if (kind === '1' || kind === '2') {
      // 1 XY sub mH mI mW hH hI path / 2 XY sub mH mI mW hH hI Xscore path, then the old path.
      const fields = entry.split(' ')
      const xy = fields[1] ?? '..'
      const path = fields.slice(kind === '1' ? 8 : 9).join(' ')
      const oldPath = kind === '2' ? (entries[++i] ?? null) : null
      const x = xy[0] ?? '.'
      const y = xy[1] ?? '.'
      if (x !== '.') add(status.staged, { path, oldPath: x === 'R' || x === 'C' ? oldPath : null, state: STATE[x] ?? 'modified' })
      if (y !== '.') add(status.unstaged, { path, oldPath: null, state: STATE[y] ?? 'modified' })
    } else if (kind === 'u') {
      add(status.conflicts, { path: entry.split(' ').slice(10).join(' '), oldPath: null, state: 'conflicted' })
    }
  }
  return status
}

export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s', '%D'].join('%x1f') + '%x1e'

/** Parses `git log --format=LOG_FORMAT`. */
export function parseLog(out: string): GitCommit[] {
  return out
    .split(RS)
    .map((r) => r.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash = '', parents = '', author = '', email = '', at = '0', subject = '', refs = ''] = record.split(FS)
      return {
        hash,
        short: hash.slice(0, 7),
        parents: parents.split(' ').filter(Boolean),
        author,
        email,
        date: Number(at) * 1000,
        subject,
        refs: refs
          .split(', ')
          .map((r) => r.trim())
          .filter(Boolean)
      }
    })
}

export const BRANCH_FORMAT = ['%(refname)', '%(refname:short)', '%(upstream:short)', '%(upstream:track,nobracket)', '%(HEAD)', '%(committerdate:unix)', '%(objectname:short)'].join('%1f') + '%1e'

/** Parses `git for-each-ref --format=BRANCH_FORMAT refs/heads refs/remotes`. */
export function parseBranches(out: string): GitBranch[] {
  const branches: GitBranch[] = []
  for (const record of out.split(RS)) {
    const [ref = '', name = '', upstream = '', track = '', head = '', at = '0', short = ''] = record.replace(/^\s+/, '').split(FS)
    if (!ref || ref.endsWith('/HEAD')) continue
    const ahead = /ahead (\d+)/.exec(track)
    const behind = /behind (\d+)/.exec(track)
    branches.push({
      name,
      remote: ref.startsWith('refs/remotes/'),
      current: head === '*',
      upstream: upstream || null,
      ahead: ahead ? Number(ahead[1]) : 0,
      behind: behind ? Number(behind[1]) : 0,
      gone: track === 'gone',
      date: Number(at) * 1000,
      short
    })
  }
  return branches
}

export const STASH_FORMAT = ['%gd', '%ct', '%gs'].join('%x1f') + '%x1e'

/** Parses `git stash list --format=STASH_FORMAT`. */
export function parseStashes(out: string): GitStash[] {
  return out
    .split(RS)
    .map((r) => r.replace(/^\s+/, ''))
    .filter(Boolean)
    .flatMap((record) => {
      const [ref = '', at = '0', message = ''] = record.split(FS)
      const m = /\{(\d+)\}/.exec(ref)
      return m ? [{ index: Number(m[1]), message: message.replace(/^On [^:]+: /, ''), date: Number(at) * 1000 }] : []
    })
}

export interface ParsedDiff {
  /** The lines before the first hunk (`diff --git`, `index`, `---`, `+++`), needed to apply a hunk alone. */
  header: string[]
  hunks: GitHunk[]
  binary: boolean
}

/** Parses the unified diff of one file (`git diff -- <path>`). */
export function parseDiff(out: string): ParsedDiff {
  const lines = out.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const parsed: ParsedDiff = { header: [], hunks: [], binary: false }
  let hunk: GitHunk | null = null
  for (const line of lines) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (m) {
      hunk = { header: line, oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]), newStart: Number(m[3]), newLines: m[4] === undefined ? 1 : Number(m[4]), lines: [] }
      parsed.hunks.push(hunk)
    } else if (hunk) {
      hunk.lines.push(line)
    } else {
      if (/^Binary files .* differ$/.test(line) || line === 'GIT binary patch') parsed.binary = true
      parsed.header.push(line)
    }
  }
  return parsed
}

/** A patch holding only one hunk of a file's diff, for `git apply`. */
export function hunkPatch(diff: ParsedDiff, index: number): string | null {
  const hunk = diff.hunks[index]
  if (!hunk || diff.binary) return null
  return [...diff.header, hunk.header, ...hunk.lines].join('\n') + '\n'
}
