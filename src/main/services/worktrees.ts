import { t, tn } from '@shared/i18n'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { AppError } from '@shared/errors'
import type { MergeResult, TaskChange, TaskFileDiff } from '@shared/tasks'

const MAX_DIFF_BYTES = 1024 * 1024
const BRANCH_PREFIX = 'atelier/'
/** Used only when the repository has no git identity configured. */
const FALLBACK_IDENTITY = ['-c', 'user.name=Atelier', '-c', 'user.email=atelier@localhost']

export interface WorktreeRef {
  repoRoot: string
  baseBranch: string
  branch: string
  worktreePath: string
}

function git(dir: string): SimpleGit {
  return simpleGit({ baseDir: dir, maxConcurrentProcesses: 4, trimmed: false })
}

/** ASCII slug for branch and folder names. */
export function branchSlug(title: string, id: string): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/, '') || 'task'
  return `${base}-${id.replace(/-/g, '').slice(0, 6)}`
}

function statusOf(code: string): TaskChange['status'] {
  if (code.startsWith('A')) return 'added'
  if (code.startsWith('D')) return 'deleted'
  if (code.startsWith('R')) return 'renamed'
  return 'modified'
}

/** Parses `git diff --name-status -z`. */
export function parseNameStatus(out: string): TaskChange[] {
  const parts = out.split('\0').filter((p) => p !== '')
  const changes: TaskChange[] = []
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++] ?? ''
    if (code.startsWith('R') || code.startsWith('C')) {
      const oldPath = parts[i++] ?? ''
      const path = parts[i++] ?? ''
      changes.push({ path, oldPath, status: code.startsWith('R') ? 'renamed' : 'added' })
    } else {
      const path = parts[i++] ?? ''
      changes.push({ path, oldPath: null, status: statusOf(code) })
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Git worktrees for tasks: one branch `atelier/<slug>` and one folder per task, outside the
 * repository so watchers and tooling never see them.
 */
export class WorktreeService {
  /** `root` is read each time, so a new folder in Settings applies to the next task. */
  constructor(private readonly rootOf: string | (() => string)) {}

  private get root(): string {
    return typeof this.rootOf === 'string' ? this.rootOf : this.rootOf()
  }

  async isRepo(dir: string): Promise<boolean> {
    try {
      return (await git(dir).raw(['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
    } catch {
      return false
    }
  }

  /** The repository's top folder, for a folder anywhere inside it. */
  async topLevel(dir: string): Promise<string> {
    return (await git(dir).raw(['rev-parse', '--show-toplevel'])).trim()
  }

  async currentBranch(dir: string): Promise<string> {
    const name = (await git(dir).raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (name === 'HEAD') throw new AppError('invalid_request', t('The repository is on a detached HEAD. Check out a branch first.'))
    return name
  }

  folderFor(repoRoot: string, slug: string): string {
    const real = existsSync(repoRoot) ? realpathSync(repoRoot) : repoRoot
    const hash = createHash('sha1').update(real.toLowerCase()).digest('hex').slice(0, 10)
    return join(this.root, hash, slug)
  }

  async create(repoRoot: string, baseBranch: string, slug: string): Promise<WorktreeRef> {
    const branch = `${BRANCH_PREFIX}${slug}`
    const worktreePath = this.folderFor(repoRoot, slug)
    await mkdir(join(worktreePath, '..'), { recursive: true })
    try {
      await git(repoRoot).raw(['worktree', 'add', '-b', branch, worktreePath, baseBranch])
    } catch (err) {
      throw new AppError('io_error', t('Could not create the worktree: {message}', { message: (err as Error).message.trim() }))
    }
    return { repoRoot, baseBranch, branch, worktreePath }
  }

  /** The point the branch started from; the review compares against it. */
  private async mergeBase(ref: WorktreeRef): Promise<string> {
    return (await git(ref.worktreePath).raw(['merge-base', ref.baseBranch, 'HEAD'])).trim()
  }

  /** Everything the agent changed: its commits plus uncommitted and untracked files. */
  async changes(ref: WorktreeRef): Promise<TaskChange[]> {
    const g = git(ref.worktreePath)
    await g.raw(['add', '-A'])
    const base = await this.mergeBase(ref)
    return parseNameStatus(await g.raw(['diff', '--cached', '--name-status', '-M', '-z', base]))
  }

  async fileDiff(ref: WorktreeRef, change: TaskChange): Promise<TaskFileDiff> {
    const base = await this.mergeBase(ref)
    const out: TaskFileDiff = { path: change.path, original: '', modified: '', unsupported: false }
    const text = (buf: Buffer) => {
      if (buf.length > MAX_DIFF_BYTES || buf.includes(0)) {
        out.unsupported = true
        return ''
      }
      return buf.toString('utf8')
    }
    if (change.status !== 'added') {
      const before = await git(ref.worktreePath).binaryCatFile(['blob', `${base}:${change.oldPath ?? change.path}`])
      out.original = text(before)
    }
    if (change.status !== 'deleted') {
      const file = join(ref.worktreePath, change.path)
      if ((await stat(file)).size > MAX_DIFF_BYTES) out.unsupported = true
      else out.modified = text(await readFile(file))
    }
    return out
  }

  private async identity(dir: string): Promise<string[]> {
    try {
      const email = (await git(dir).raw(['config', 'user.email'])).trim()
      return email ? [] : FALLBACK_IDENTITY
    } catch {
      return FALLBACK_IDENTITY
    }
  }

  private async gitDir(dir: string): Promise<string> {
    return (await git(dir).raw(['rev-parse', '--absolute-git-dir'])).trim()
  }

  /** Commits what the agent left uncommitted. Returns false when there was nothing to commit. */
  async commitAll(ref: WorktreeRef, message: string): Promise<boolean> {
    const g = git(ref.worktreePath)
    await g.raw(['add', '-A'])
    const staged = (await g.raw(['diff', '--cached', '--name-only'])).trim()
    if (!staged) return false
    await g.raw([...(await this.identity(ref.worktreePath)), 'commit', '--no-verify', '-m', message])
    return true
  }

  /**
   * Merges the task branch into its base with --no-ff, in the main folder. On a conflict the
   * merge is aborted, nothing changes, and the conflicting files are returned.
   */
  async merge(ref: WorktreeRef, title: string, { cleanup = true }: { cleanup?: boolean } = {}): Promise<MergeResult> {
    await this.commitAll(ref, title)
    const current = await this.currentBranch(ref.repoRoot)
    if (current !== ref.baseBranch) {
      return {
        ok: false,
        reason: t('The main folder is on {current}. Check out {baseBranch} there, then merge again.', { current, baseBranch: ref.baseBranch }),
        conflicts: []
      }
    }
    const g = git(ref.repoRoot)
    const ahead = (await g.raw(['rev-list', '--count', `${ref.baseBranch}..${ref.branch}`])).trim()
    if (ahead === '0') return { ok: false, reason: t('The agent changed nothing, so there is nothing to merge.'), conflicts: [] }
    let failure: string | null = null
    try {
      await g.raw([
        ...(await this.identity(ref.repoRoot)),
        'merge',
        '--no-ff',
        '--no-edit',
        '-m',
        `Merge ${ref.branch}: ${title}`,
        ref.branch
      ])
    } catch (err) {
      failure = (err as Error).message
    }
    // simple-git only throws when git writes to stderr; a conflict is reported on stdout.
    const conflicts = (await g.raw(['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const merging = existsSync(join(await this.gitDir(ref.repoRoot), 'MERGE_HEAD'))
    if (failure !== null || conflicts.length || merging) {
      if (merging || conflicts.length) await g.raw(['merge', '--abort']).catch(() => undefined)
      return {
        ok: false,
        reason: conflicts.length
          ? tn('The merge has conflicts in {count} file. It was undone; resolve them by asking the agent or by hand.', 'The merge has conflicts in {count} files. It was undone; resolve them by asking the agent or by hand.', conflicts.length)
          : /overwritten|uncommitted|local changes/i.test(failure ?? '')
            ? t('Uncommitted changes in the main folder would be overwritten. Commit or stash them, then merge again.')
            : t('git merge failed: {message}', { message: (failure ?? t('unknown error')).trim().split('\n')[0] }),
        conflicts
      }
    }
    const commit = (await g.raw(['rev-parse', 'HEAD'])).trim()
    if (cleanup) await this.remove(ref, { deleteBranch: true })
    return { ok: true, commit }
  }

  /** Removes the worktree folder and, when asked, the branch. Safe to call twice. */
  async remove(ref: WorktreeRef, { deleteBranch }: { deleteBranch: boolean }): Promise<void> {
    const g = git(ref.repoRoot)
    await g.raw(['worktree', 'remove', '--force', ref.worktreePath]).catch(() => undefined)
    if (existsSync(ref.worktreePath)) await rm(ref.worktreePath, { recursive: true, force: true })
    await g.raw(['worktree', 'prune']).catch(() => undefined)
    if (deleteBranch) await g.raw(['branch', '-D', ref.branch]).catch(() => undefined)
  }
}
