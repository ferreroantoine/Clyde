import { z } from 'zod'

/** What happened to a file, as the Source view shows it. */
export type GitFileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'untracked' | 'conflicted'

/** Paths are relative to the repository root, with forward slashes. */
export interface GitFileChange {
  path: string
  oldPath: string | null
  state: GitFileState
}

export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export interface GitStatus {
  /** False when the open folder is not in a git repository; the rest is then empty. */
  isRepo: boolean
  /** The repository's top folder. */
  root: string
  /** Where the open folder sits in the repository (`src/app/`), empty at the top. */
  prefix: string
  /** Null on a detached HEAD. */
  branch: string | null
  /** Null before the first commit. */
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: GitFileChange[]
  conflicts: GitFileChange[]
  /** A merge, rebase, cherry-pick or revert waiting to be finished or aborted. */
  operation: GitOperation | null
  /** Set when there were too many changes to list them all. */
  truncated: boolean
}

export interface GitCommit {
  hash: string
  short: string
  parents: string[]
  author: string
  email: string
  /** ms */
  date: number
  subject: string
  /** Branch and tag names pointing here (`HEAD -> main`, `origin/main`, `tag: v1`). */
  refs: string[]
}

export interface GitBranch {
  /** `main`, or `origin/main` for a remote branch. */
  name: string
  remote: boolean
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** The upstream branch was deleted on the remote. */
  gone: boolean
  /** ms */
  date: number
  short: string
}

export interface GitStash {
  index: number
  message: string
  /** ms */
  date: number
}

export interface GitHunk {
  /** The `@@ -a,b +c,d @@ …` line. */
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Body lines with their ` `, `+`, `-` or `\` prefix. */
  lines: string[]
}

export type GitDiffMode = 'unstaged' | 'staged'

export interface GitFileDiff {
  path: string
  original: string
  modified: string
  /** Binary or too large to show. */
  unsupported: boolean
  /** Hunks of the change, for staging or discarding a part of it; empty for commits. */
  hunks: GitHunk[]
}

/** A restore point Clyde made before an agent session worked in the project. */
export interface GitCheckpoint {
  sessionId: string
  title: string | null
  profileId: string
  commit: string
  /** ms */
  createdAt: number
}

/** An agent session that wrote to a file. */
export interface FileSession {
  sessionId: string
  title: string | null
  profileId: string
  /** When it last wrote to the file (ms). */
  at: number
}

export interface GitResult {
  ok: boolean
  /** What went wrong, or what git said. */
  message: string
  conflicts: string[]
}

const gitPath = z.string().min(1).max(4096)
const paths = z.array(gitPath).min(1).max(5000)
const ref = z
  .string()
  .min(1)
  .max(250)
  .refine((r) => !r.startsWith('-') && !/[\s~^:?*[\\]|\.\.|@\{/.test(r), 'Invalid ref name')
const hash = z.string().regex(/^[0-9a-f]{4,64}$/i)

export const gitSchemas = {
  paths: z.object({ paths }),
  diff: z.object({ path: gitPath, mode: z.enum(['unstaged', 'staged']), oldPath: gitPath.optional() }),
  hunk: z.object({ path: gitPath, mode: z.enum(['unstaged', 'staged']), index: z.number().int().min(0).max(10_000), action: z.enum(['stage', 'unstage', 'discard']) }),
  commit: z.object({ message: z.string().trim().min(1).max(20_000), amend: z.boolean().default(false), push: z.boolean().default(false) }),
  log: z.object({ all: z.boolean().default(false), limit: z.number().int().min(1).max(2000).default(300), skip: z.number().int().min(0).default(0) }),
  hash: z.object({ hash }),
  commitDiff: z.object({ hash, path: gitPath, oldPath: gitPath.optional() }),
  checkout: z.object({ ref: z.union([ref, hash]) }),
  createBranch: z.object({ name: ref, from: z.union([ref, hash]).optional(), checkout: z.boolean().default(true) }),
  deleteBranch: z.object({ name: ref, remote: z.boolean().default(false), force: z.boolean().default(false) }),
  merge: z.object({ ref }),
  stash: z.object({ message: z.string().max(500).default(''), untracked: z.boolean().default(true) }),
  stashApply: z.object({ index: z.number().int().min(0).max(10_000), pop: z.boolean().default(false) }),
  stashDrop: z.object({ index: z.number().int().min(0).max(10_000) }),
  session: z.object({ sessionId: z.string().min(1).max(64) })
}
