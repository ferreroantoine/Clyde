import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { t, tn } from '@shared/i18n'
import { AppError } from '@shared/errors'
import type { GitBranch, GitCommit, GitDiffMode, GitFileChange, GitFileDiff, GitOperation, GitResult, GitStash, GitStatus } from '@shared/git'
import { resolveInside } from '../services/paths'
import { parseNameStatus } from '../services/worktrees'
import { BRANCH_FORMAT, hunkPatch, LOG_FORMAT, parseBranches, parseDiff, parseLog, parseStashes, parseStatus, STASH_FORMAT } from './parse'
import { git, GitCommandError, runGit, type RunOptions } from './run'

const MAX_DIFF_BYTES = 1024 * 1024
const NETWORK_TIMEOUT = 5 * 60_000
const WATCH_DEBOUNCE_MS = 250
/** Inside .git, only what changes the status, branches or history is watched. */
const WATCH_IGNORED = /[\\/](?:objects|logs|hooks|lfs|modules|info)(?:[\\/]|$)|\.lock$/

export interface Repo {
  /** The repository's top folder. */
  root: string
  /** The open folder relative to it, `src/` style; empty at the top. */
  prefix: string
  gitDir: string
  commonDir: string
}

const EMPTY: Omit<GitStatus, 'root'> = {
  isRepo: false,
  prefix: '',
  branch: null,
  head: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicts: [],
  operation: null,
  truncated: false
}

/** Finds the repository a folder belongs to; null when it is not in one. */
export async function findRepo(dir: string): Promise<Repo | null> {
  try {
    const out = await git(['rev-parse', '--show-toplevel', '--show-prefix', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir'], { cwd: dir })
    const [top = '', prefix = '', gitDir = '', common = ''] = out.split('\n').map((l) => l.trim())
    if (!top) return null
    return { root: resolve(top), prefix, gitDir: resolve(gitDir), commonDir: resolve(common) }
  } catch {
    return null
  }
}

/**
 * The Source view's git: status, staging, commits, branches, history and stashes of the
 * repository holding the open folder. Paths over IPC are relative to the repository root.
 */
export class GitService {
  private repo: Repo | null = null
  private dir: string | null = null
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly deps: {
      onChanged: () => void
      /** Moves an untracked file to the Recycle Bin instead of deleting it. */
      trash: (abs: string) => Promise<void>
    }
  ) {}

  /** The open folder changed: finds its repository and watches it. */
  async open(dir: string | null): Promise<void> {
    this.dir = dir
    this.repo = dir ? await findRepo(dir) : null
    await this.watch()
    this.deps.onChanged()
  }

  current(): Repo | null {
    return this.repo
  }

  private async watch(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
    if (!this.repo) return
    const targets = [...new Set([this.repo.gitDir, this.repo.commonDir])].filter((p) => existsSync(p))
    this.watcher = watch(targets, { ignoreInitial: true, depth: 4, ignored: (p) => WATCH_IGNORED.test(p) })
    this.watcher.on('all', () => {
      this.timer ??= setTimeout(() => {
        this.timer = null
        this.deps.onChanged()
      }, WATCH_DEBOUNCE_MS)
    })
    this.watcher.on('error', () => undefined)
  }

  async dispose(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    await this.watcher?.close()
    this.watcher = null
  }

  private require(): Repo {
    if (!this.repo) throw new AppError('invalid_request', t('The open folder is not in a git repository'))
    return this.repo
  }

  private run(args: string[], options: Partial<RunOptions> = {}): Promise<string> {
    return git(args, { cwd: this.require().root, ...options })
  }

  private abs(path: string): string {
    return resolveInside(this.require().root, path)
  }

  // Status

  async status(): Promise<GitStatus> {
    const repo = this.repo
    if (!repo) return { ...EMPTY, root: this.dir ?? '' }
    const out = await git(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], { cwd: repo.root })
    return { ...EMPTY, ...parseStatus(out), isRepo: true, root: repo.root, prefix: repo.prefix, operation: this.operation() }
  }

  private operation(): GitOperation | null {
    const dir = this.repo?.gitDir
    if (!dir) return null
    if (existsSync(join(dir, 'rebase-merge')) || existsSync(join(dir, 'rebase-apply'))) return 'rebase'
    if (existsSync(join(dir, 'MERGE_HEAD'))) return 'merge'
    if (existsSync(join(dir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
    if (existsSync(join(dir, 'REVERT_HEAD'))) return 'revert'
    return null
  }

  /** Creates a repository in the open folder. */
  async init(): Promise<void> {
    if (!this.dir) throw new AppError('no_workspace', t('Open a folder first'))
    await git(['init'], { cwd: this.dir })
    await this.open(this.dir)
  }

  private async hasHead(): Promise<boolean> {
    const r = await runGit(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: this.require().root, okCodes: [0, 1, 128] })
    return r.code === 0
  }

  /** Which of these open-folder paths git ignores. */
  async ignored(paths: string[]): Promise<string[]> {
    if (!this.repo || !this.dir || !paths.length) return []
    const r = await runGit(['check-ignore', '-z', '--stdin'], { cwd: this.dir, input: paths.join('\0') + '\0', okCodes: [0, 1] })
    return r.stdout.toString('utf8').split('\0').filter(Boolean)
  }

  // Staging

  async stage(paths: string[]): Promise<void> {
    await this.run(['add', '-A', '--', ...paths])
  }

  async stageAll(): Promise<void> {
    await this.run(['add', '-A'])
  }

  async unstage(paths: string[]): Promise<void> {
    if (await this.hasHead()) await this.run(['restore', '--staged', '--', ...paths])
    else await this.run(['rm', '--cached', '-r', '-q', '--', ...paths])
  }

  async unstageAll(): Promise<void> {
    if (await this.hasHead()) await this.run(['reset', '-q'])
    else await this.run(['rm', '--cached', '-r', '-q', '.'])
  }

  /** Throws away changes not staged: tracked files go back to their staged version, new files to the Recycle Bin. */
  async discard(paths: string[]): Promise<void> {
    const status = await this.status()
    const untracked = new Set(status.untracked.map((c) => c.path))
    const tracked = paths.filter((p) => !untracked.has(p))
    for (const p of paths.filter((p) => untracked.has(p))) await this.deps.trash(this.abs(p))
    if (tracked.length) await this.run(['restore', '--worktree', '--', ...tracked])
  }

  // Diffs

  private async blob(spec: string): Promise<Buffer | null> {
    const r = await runGit(['cat-file', 'blob', spec], { cwd: this.require().root, okCodes: [0, 128] })
    return r.code === 0 ? r.stdout : null
  }

  private async workFile(path: string): Promise<Buffer | null> {
    const file = this.abs(path)
    try {
      if ((await stat(file)).size > MAX_DIFF_BYTES) return Buffer.alloc(MAX_DIFF_BYTES + 1)
      return await readFile(file)
    } catch {
      return null
    }
  }

  private static texts(original: Buffer | null, modified: Buffer | null, path: string): GitFileDiff {
    const out: GitFileDiff = { path, original: '', modified: '', unsupported: false, hunks: [] }
    const text = (buf: Buffer | null) => {
      if (!buf) return ''
      if (buf.length > MAX_DIFF_BYTES || buf.includes(0)) {
        out.unsupported = true
        return ''
      }
      return buf.toString('utf8')
    }
    out.original = text(original)
    out.modified = text(modified)
    return out
  }

  private async patchOf(path: string, mode: GitDiffMode) {
    const out = await this.run(['diff', '--no-ext-diff', '-U3', ...(mode === 'staged' ? ['--cached'] : []), '--', path])
    return parseDiff(out)
  }

  /** One file's change: `unstaged` compares the staged version with the file, `staged` the last commit with the staged version. */
  async diff(path: string, mode: GitDiffMode, oldPath?: string): Promise<GitFileDiff> {
    this.abs(path)
    const [original, modified] =
      mode === 'staged'
        ? [(await this.hasHead()) ? await this.blob(`HEAD:${oldPath ?? path}`) : null, await this.blob(`:${path}`)]
        : [await this.blob(`:${path}`), await this.workFile(path)]
    const diff = GitService.texts(original, modified, path)
    if (!diff.unsupported) diff.hunks = (await this.patchOf(path, mode)).hunks
    return diff
  }

  /** Stages, unstages or discards one hunk of a file's diff, as it is now. */
  async applyHunk(path: string, mode: GitDiffMode, index: number, action: 'stage' | 'unstage' | 'discard'): Promise<void> {
    this.abs(path)
    if ((mode === 'staged') !== (action === 'unstage')) throw new AppError('invalid_request', t('This part cannot be changed that way'))
    const patch = hunkPatch(await this.patchOf(path, mode), index)
    if (!patch) throw new AppError('not_found', t('This part of the change no longer exists. Refresh and try again.'))
    const flags = action === 'stage' ? ['--cached'] : action === 'unstage' ? ['--cached', '--reverse'] : ['--reverse']
    await this.run(['apply', ...flags, '--whitespace=nowarn', '--recount', '-'], { input: patch })
  }

  // Commits

  async commit(message: string, { amend }: { amend: boolean }): Promise<string> {
    await this.run(['commit', '-F', '-', ...(amend ? ['--amend'] : [])], { input: message })
    return (await this.run(['rev-parse', 'HEAD'])).trim()
  }

  async lastMessage(): Promise<string> {
    if (!(await this.hasHead())) return ''
    return (await this.run(['log', '-1', '--format=%B'])).trim()
  }

  /** The staged diff (clipped) and the last subjects, for a commit message. */
  async stagedSummary(maxChars = 24_000): Promise<{ diff: string; stat: string; subjects: string[] }> {
    const stat = await this.run(['diff', '--cached', '--stat'])
    let diff = await this.run(['diff', '--cached', '--no-ext-diff', '-U2'])
    if (diff.length > maxChars) diff = diff.slice(0, maxChars) + '\n[…]'
    const subjects = (await this.hasHead()) ? (await this.run(['log', '-20', '--format=%s'])).split('\n').filter(Boolean) : []
    return { diff, stat, subjects }
  }

  // History

  async log({ all, limit, skip }: { all: boolean; limit: number; skip: number }): Promise<GitCommit[]> {
    if (!(await this.hasHead()) && !all) return []
    const out = await this.run(['log', `--format=${LOG_FORMAT}`, '--topo-order', `--max-count=${limit}`, `--skip=${skip}`, ...(all ? ['--all'] : ['HEAD']), '--'])
    return parseLog(out)
  }

  private async parentsOf(hash: string): Promise<string[]> {
    const out = await this.run(['rev-list', '--parents', '-n', '1', hash])
    return out.trim().split(' ').slice(1)
  }

  /** Files a commit changed, against its first parent. */
  async commitFiles(hash: string): Promise<GitFileChange[]> {
    const [parent] = await this.parentsOf(hash)
    const out = parent
      ? await this.run(['diff', '--name-status', '-z', '-M', parent, hash, '--'])
      : await this.run(['diff-tree', '--root', '--no-commit-id', '-r', '-z', '-M', '--name-status', hash])
    return parseNameStatus(out).map((c) => ({ path: c.path, oldPath: c.oldPath, state: c.status }))
  }

  async commitDiff(hash: string, path: string, oldPath?: string): Promise<GitFileDiff> {
    const [parent] = await this.parentsOf(hash)
    const original = parent ? await this.blob(`${parent}:${oldPath ?? path}`) : null
    return GitService.texts(original, await this.blob(`${hash}:${path}`), path)
  }

  /** Reverts or cherry-picks a commit; conflicts are left to resolve. */
  async pick(kind: 'revert' | 'cherry-pick', hash: string): Promise<GitResult> {
    const parents = await this.parentsOf(hash)
    return this.conflictAware([kind, '--no-edit', ...(parents.length > 1 ? ['-m', '1'] : []), hash])
  }

  // Branches

  async branches(): Promise<GitBranch[]> {
    return parseBranches(await this.run(['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes']))
  }

  /** Checks out a branch, a remote branch (as a local branch that tracks it) or a commit (detached). */
  async checkout(ref: string): Promise<void> {
    const branches = await this.branches()
    const remote = branches.find((b) => b.remote && b.name === ref)
    if (remote) {
      const local = ref.slice(ref.indexOf('/') + 1)
      if (branches.some((b) => !b.remote && b.name === local)) await this.run(['checkout', local])
      else await this.run(['checkout', '-b', local, '--track', ref])
      return
    }
    if (branches.some((b) => !b.remote && b.name === ref)) await this.run(['checkout', ref])
    else await this.run(['checkout', '--detach', ref])
  }

  async createBranch(name: string, from: string | undefined, checkout: boolean): Promise<void> {
    await this.run(checkout ? ['checkout', '-b', name, ...(from ? [from] : [])] : ['branch', name, ...(from ? [from] : [])])
  }

  async deleteBranch(name: string, { remote, force }: { remote: boolean; force: boolean }): Promise<void> {
    if (remote) {
      const slash = name.indexOf('/')
      await this.run(['push', name.slice(0, slash), '--delete', name.slice(slash + 1)], { timeout: NETWORK_TIMEOUT })
    } else {
      await this.run(['branch', force ? '-D' : '-d', name])
    }
  }

  async merge(ref: string): Promise<GitResult> {
    return this.conflictAware(['merge', '--no-edit', ref])
  }

  /** Runs a command that may stop on conflicts; they stay for the user (or an agent) to resolve. */
  private async conflictAware(args: string[]): Promise<GitResult> {
    try {
      const out = await this.run(args, { env: { GIT_EDITOR: 'true' } })
      return { ok: true, message: out.trim().split('\n').at(-1) ?? '', conflicts: [] }
    } catch (err) {
      const conflicts = (await this.status().catch(() => null))?.conflicts.map((c) => c.path) ?? []
      if (conflicts.length) {
        return { ok: false, message: tn('Conflicts in {count} file. Resolve them, then commit.', 'Conflicts in {count} files. Resolve them, then commit.', conflicts.length), conflicts }
      }
      if (err instanceof GitCommandError) return { ok: false, message: err.message, conflicts: [] }
      throw err
    }
  }

  /** Stops a merge, rebase, cherry-pick or revert and goes back to how things were. */
  async abort(): Promise<void> {
    const op = this.operation()
    if (!op) return
    await this.run([op, '--abort'])
  }

  /** Carries on once conflicts are resolved and staged. */
  async continueOperation(): Promise<GitResult> {
    const op = this.operation()
    if (!op) return { ok: true, message: '', conflicts: [] }
    return this.conflictAware(op === 'merge' ? ['commit', '--no-edit'] : [op, '--continue'])
  }

  // Remotes

  private async remoteName(): Promise<string> {
    const remotes = (await this.run(['remote'])).split('\n').map((r) => r.trim()).filter(Boolean)
    if (!remotes.length) throw new AppError('invalid_request', t('This repository has no remote. Add one with git remote add.'))
    return remotes.includes('origin') ? 'origin' : (remotes[0] as string)
  }

  async fetch(): Promise<void> {
    await this.run(['fetch', '--all', '--prune'], { timeout: NETWORK_TIMEOUT })
  }

  async pull(): Promise<GitResult> {
    const status = await this.status()
    if (!status.upstream) throw new AppError('invalid_request', t('This branch has no upstream branch. Publish it first.'))
    try {
      await this.run(['pull', '--no-edit'], { timeout: NETWORK_TIMEOUT, env: { GIT_EDITOR: 'true' } })
      return { ok: true, message: '', conflicts: [] }
    } catch (err) {
      const conflicts = (await this.status()).conflicts.map((c) => c.path)
      if (conflicts.length) return { ok: false, message: tn('Conflicts in {count} file. Resolve them, then commit.', 'Conflicts in {count} files. Resolve them, then commit.', conflicts.length), conflicts }
      throw err
    }
  }

  /** Pushes the current branch; a branch without upstream is published to the first remote. */
  async push(): Promise<void> {
    const status = await this.status()
    if (!status.branch) throw new AppError('invalid_request', t('Check out a branch to push it'))
    if (status.upstream) await this.run(['push'], { timeout: NETWORK_TIMEOUT })
    else await this.run(['push', '-u', await this.remoteName(), status.branch], { timeout: NETWORK_TIMEOUT })
  }

  // Stashes

  async stashes(): Promise<GitStash[]> {
    if (!(await this.hasHead())) return []
    return parseStashes(await this.run(['stash', 'list', `--format=${STASH_FORMAT}`]))
  }

  async stash(message: string, untracked: boolean): Promise<void> {
    await this.run(['stash', 'push', ...(untracked ? ['-u'] : []), ...(message ? ['-m', message] : [])])
  }

  async stashApply(index: number, pop: boolean): Promise<GitResult> {
    return this.conflictAware(['stash', pop ? 'pop' : 'apply', `stash@{${index}}`])
  }

  async stashDrop(index: number): Promise<void> {
    await this.run(['stash', 'drop', `stash@{${index}}`])
  }
}
