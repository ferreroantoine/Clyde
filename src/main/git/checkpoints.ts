import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import type { FileSession, GitCheckpoint, GitFileChange } from '@shared/git'
import type { Db } from '../services/db/database'
import { isInside, toRel } from '../services/paths'
import { parseNameStatus } from '../services/worktrees'
import { findRepo } from './service'
import { git } from './run'

/** Restore points kept per repository; older ones are forgotten. */
const KEEP = 30
const REF_PREFIX = 'refs/clyde/checkpoints/'
/** Tools that write files, and where their input names the file. */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'write_file', 'edit_file'])

interface Row {
  session_id: string
  repo_root: string
  commit_hash: string
  created_at: number
  title: string | null
  profile_id: string | null
}

/** The files a write tool call touched, as written in its input. */
export function writtenPaths(name: string, input: Record<string, unknown>): string[] {
  if (!WRITE_TOOLS.has(name)) return []
  const out: string[] = []
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const v = input[key]
    if (typeof v === 'string' && v) out.push(v)
  }
  // Codex reports a patch over several files.
  if (Array.isArray(input['changes'])) {
    for (const c of input['changes']) {
      const p = (c as { path?: unknown }).path
      if (typeof p === 'string' && p) out.push(p)
    }
  }
  return [...new Set(out)]
}

/** Snapshots the working tree, untracked files included, into a tree object; nothing visible changes. */
async function snapshotTree(root: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clyde-index-'))
  const index = join(dir, 'index')
  try {
    // Starting from the real index keeps its file stats, so unchanged files are not hashed again.
    const real = resolve(root, (await git(['rev-parse', '--git-path', 'index'], { cwd: root })).trim())
    const copied = await copyFile(real, index).then(
      () => true,
      () => false
    )
    const env = { GIT_INDEX_FILE: index }
    if (!copied) await git(['read-tree', '--empty'], { cwd: root, env })
    await git(['add', '-A'], { cwd: root, env, timeout: 120_000 })
    return (await git(['write-tree'], { cwd: root, env })).trim()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Restore points: before an agent session works in the open project, Clyde records the working
 * tree as a commit kept under refs/clyde/checkpoints (so git keeps it). Restoring brings the files
 * back to that state, whatever the agent (or anyone) changed since.
 */
export class CheckpointService {
  constructor(private readonly db: Db) {}

  /** Records the state of `cwd`'s repository for a session; does nothing outside a repository or when one exists. */
  async create(sessionId: string, cwd: string): Promise<GitCheckpoint | null> {
    if (this.db.prepare('SELECT 1 FROM git_checkpoints WHERE session_id = ?').get(sessionId)) return null
    const repo = await findRepo(cwd)
    if (!repo) return null
    const tree = await snapshotTree(repo.root)
    const head = (await git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: repo.root }).catch(() => '')).trim()
    const commit = (
      await git(['-c', 'user.name=Clyde', '-c', 'user.email=clyde@localhost', 'commit-tree', tree, ...(head ? ['-p', head] : []), '-m', `Clyde restore point before session ${sessionId}`], {
        cwd: repo.root
      })
    ).trim()
    await git(['update-ref', REF_PREFIX + sessionId, commit], { cwd: repo.root })
    const now = Date.now()
    this.db.prepare('INSERT OR IGNORE INTO git_checkpoints (session_id, repo_root, commit_hash, created_at) VALUES (?, ?, ?, ?)').run(sessionId, repo.root, commit, now)
    await this.prune(repo.root)
    return { sessionId, title: null, profileId: '', commit, createdAt: now }
  }

  private async prune(root: string): Promise<void> {
    const old = this.db
      .prepare('SELECT session_id FROM git_checkpoints WHERE repo_root = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?')
      .all(root, KEEP) as Array<{ session_id: string }>
    for (const { session_id } of old) {
      await git(['update-ref', '-d', REF_PREFIX + session_id], { cwd: root }).catch(() => undefined)
      this.db.prepare('DELETE FROM git_checkpoints WHERE session_id = ?').run(session_id)
    }
  }

  private rows(root: string): Row[] {
    return this.db
      .prepare(
        `SELECT c.*, s.title, s.profile_id FROM git_checkpoints c LEFT JOIN sessions s ON s.id = c.session_id
         WHERE c.repo_root = ? ORDER BY c.created_at DESC`
      )
      .all(root) as Row[]
  }

  list(root: string): GitCheckpoint[] {
    return this.rows(root).map((r) => ({ sessionId: r.session_id, title: r.title, profileId: r.profile_id ?? '', commit: r.commit_hash, createdAt: r.created_at }))
  }

  private row(root: string, sessionId: string): Row {
    const row = this.rows(root).find((r) => r.session_id === sessionId)
    if (!row) throw new AppError('not_found', t('No restore point for this session'))
    return row
  }

  /** Files that differ now from the restore point. */
  async changes(root: string, sessionId: string): Promise<GitFileChange[]> {
    const row = this.row(root, sessionId)
    const now = await snapshotTree(root)
    const out = await git(['diff', '--name-status', '-z', '--no-renames', `${row.commit_hash}^{tree}`, now], { cwd: root })
    return parseNameStatus(out).map((c) => ({ path: c.path, oldPath: null, state: c.status }))
  }

  /** Puts every file back as it was at the restore point; files created since are deleted. Returns how many changed. */
  async restore(root: string, sessionId: string, trash: (abs: string) => Promise<void>): Promise<number> {
    const row = this.row(root, sessionId)
    const changes = await this.changes(root, sessionId)
    const created = changes.filter((c) => c.state === 'added').map((c) => c.path)
    const back = changes.filter((c) => c.state !== 'added').map((c) => c.path)
    for (const path of created) await trash(join(root, path))
    // Batches keep the command line under Windows' limit.
    for (let i = 0; i < back.length; i += 200) {
      await git(['restore', `--source=${row.commit_hash}`, '--worktree', '--', ...back.slice(i, i + 200)], { cwd: root })
    }
    return changes.length
  }

  /**
   * Agent sessions that wrote to files of this repository in the last `days`, by file
   * (repository-relative path), newest first.
   */
  fileSessions(root: string, days = 30): Record<string, FileSession[]> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000
    const rows = this.db
      .prepare(
        `SELECT s.id, s.title, s.profile_id, s.cwd, e.at, json_extract(e.event, '$.name') AS name, json_extract(e.event, '$.input') AS input
         FROM sessions s JOIN session_events e ON e.session_id = s.id
         WHERE s.started_at >= ? AND s.chat_id IS NULL AND s.task_id IS NULL AND json_extract(e.event, '$.type') = 'tool_call'
           AND json_extract(e.event, '$.name') IN (${[...WRITE_TOOLS].map(() => '?').join(', ')})`
      )
      .all(since, ...WRITE_TOOLS) as Array<{ id: string; title: string | null; profile_id: string; cwd: string; at: number; name: string; input: string }>
    const byFile: Record<string, Map<string, FileSession>> = {}
    for (const r of rows) {
      let input: Record<string, unknown>
      try {
        input = JSON.parse(r.input) as Record<string, unknown>
      } catch {
        continue
      }
      for (const p of writtenPaths(r.name, input)) {
        const abs = isAbsolute(p) ? p : resolve(r.cwd, p)
        if (!isInside(root, abs)) continue
        const rel = toRel(root, abs)
        const sessions = (byFile[rel] ??= new Map())
        const known = sessions.get(r.id)
        if (!known || known.at < r.at) sessions.set(r.id, { sessionId: r.id, title: r.title, profileId: r.profile_id, at: r.at })
      }
    }
    return Object.fromEntries(Object.entries(byFile).map(([file, map]) => [file, [...map.values()].sort((a, b) => b.at - a.at)]))
  }
}
