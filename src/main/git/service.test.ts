import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase, migrate } from '../services/db/database'
import { CheckpointService, writtenPaths } from './checkpoints'
import { GitService } from './service'

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'clyde-git-'))
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 'me@example.com')
  sh(dir, 'config', 'user.name', 'Me')
  sh(dir, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(dir, 'a.txt'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
  writeFileSync(join(dir, 'b.txt'), 'b\n')
  sh(dir, 'add', '.')
  sh(dir, 'commit', '-q', '-m', 'feat: init')
  return dir
}

async function service(dir: string) {
  const trash = vi.fn(async (abs: string) => rmSync(abs, { force: true }))
  const onChanged = vi.fn()
  const git = new GitService({ onChanged, trash })
  await git.open(dir)
  return { git, trash, onChanged }
}

describe('GitService', () => {
  it('is empty outside a repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clyde-nogit-'))
    const { git } = await service(dir)
    expect((await git.status()).isRepo).toBe(false)
    await git.init()
    expect((await git.status()).isRepo).toBe(true)
    await git.dispose()
  })

  it('stages, commits and finds the prefix of a subfolder', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'c.txt'), 'c\n')
    const { git } = await service(join(dir, 'sub'))
    let status = await git.status()
    expect(status.prefix).toBe('sub/')
    expect(status.branch).toBe('main')
    expect(status.untracked.map((c) => c.path)).toEqual(['sub/c.txt'])
    await git.stage(['sub/c.txt'])
    status = await git.status()
    expect(status.staged).toEqual([{ path: 'sub/c.txt', oldPath: null, state: 'added' }])
    const summary = await git.stagedSummary()
    expect(summary.subjects).toEqual(['feat: init'])
    expect(summary.diff).toContain('+c')
    const hash = await git.commit('Add c', { amend: false })
    expect(hash).toMatch(/^[0-9a-f]{40}$/)
    expect((await git.log({ all: false, limit: 10, skip: 0 })).map((c) => c.subject)).toEqual(['Add c', 'feat: init'])
    expect(await git.commitFiles(hash)).toEqual([{ path: 'sub/c.txt', oldPath: null, state: 'added' }])
    expect((await git.commitDiff(hash, 'sub/c.txt')).modified).toBe('c\n')
    await git.commit('Add c, again', { amend: true })
    expect(await git.lastMessage()).toBe('Add c, again')
    await git.dispose()
  })

  it('stages, unstages and discards one hunk', async () => {
    const dir = repo()
    const lines = readFileSync(join(dir, 'a.txt'), 'utf8').split('\n')
    lines[1] = 'TWO'
    lines[25] = 'TWENTY-SIX'
    writeFileSync(join(dir, 'a.txt'), lines.join('\n'))
    const { git } = await service(dir)
    const diff = await git.diff('a.txt', 'unstaged')
    expect(diff.hunks).toHaveLength(2)
    expect(diff.original).toContain('line 2\n')
    expect(diff.modified).toContain('TWO')

    await git.applyHunk('a.txt', 'unstaged', 1, 'stage')
    expect((await git.diff('a.txt', 'staged')).hunks.map((h) => h.lines.join('\n'))).toEqual([expect.stringContaining('+TWENTY-SIX')])
    expect((await git.diff('a.txt', 'unstaged')).hunks).toHaveLength(1)

    await git.applyHunk('a.txt', 'staged', 0, 'unstage')
    expect((await git.status()).staged).toEqual([])

    await git.applyHunk('a.txt', 'unstaged', 0, 'discard')
    const left = readFileSync(join(dir, 'a.txt'), 'utf8')
    expect(left).not.toContain('TWO')
    expect(left).toContain('TWENTY-SIX')
    await expect(git.applyHunk('a.txt', 'unstaged', 0, 'unstage')).rejects.toThrow()
    await git.dispose()
  })

  it('tells which explorer paths are ignored', async () => {
    const dir = repo()
    writeFileSync(join(dir, '.gitignore'), 'out/\n*.log\n')
    mkdirSync(join(dir, 'out'))
    const { git } = await service(dir)
    expect(await git.ignored(['out', 'a.txt', 'x.log', 'b.txt'])).toEqual(['out', 'x.log'])
    await git.dispose()
  })

  it('discards tracked changes and sends new files to the bin', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'b.txt'), 'changed\n')
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    const { git, trash } = await service(dir)
    await git.discard(['b.txt', 'new.txt'])
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('b\n')
    expect(trash).toHaveBeenCalledWith(join(dir, 'new.txt'))
    expect(existsSync(join(dir, 'new.txt'))).toBe(false)
    await git.dispose()
  })

  it('creates, checks out, merges and deletes branches; leaves conflicts to resolve', async () => {
    const dir = repo()
    const { git } = await service(dir)
    await git.createBranch('feature', undefined, true)
    writeFileSync(join(dir, 'b.txt'), 'feature\n')
    await git.stageAll()
    await git.commit('Feature', { amend: false })
    await git.checkout('main')
    writeFileSync(join(dir, 'b.txt'), 'main\n')
    await git.stageAll()
    await git.commit('Main', { amend: false })
    expect((await git.branches()).map((b) => [b.name, b.current])).toEqual([
      ['feature', false],
      ['main', true]
    ])

    const result = await git.merge('feature')
    expect(result.ok).toBe(false)
    expect(result.conflicts).toEqual(['b.txt'])
    const status = await git.status()
    expect(status.operation).toBe('merge')
    expect(status.conflicts.map((c) => c.path)).toEqual(['b.txt'])
    await git.abort()
    expect((await git.status()).operation).toBeNull()

    await expect(git.deleteBranch('feature', { remote: false, force: false })).rejects.toThrow()
    await git.deleteBranch('feature', { remote: false, force: true })
    expect((await git.branches()).map((b) => b.name)).toEqual(['main'])
    await git.dispose()
  })

  it('reverts a commit and checks out a commit detached', async () => {
    const dir = repo()
    const { git } = await service(dir)
    writeFileSync(join(dir, 'b.txt'), 'two\n')
    await git.stageAll()
    const hash = await git.commit('Two', { amend: false })
    expect((await git.pick('revert', hash)).ok).toBe(true)
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('b\n')
    await git.checkout(hash)
    expect((await git.status()).branch).toBeNull()
    await git.dispose()
  })

  it('stashes, lists, applies and drops', async () => {
    const dir = repo()
    const { git } = await service(dir)
    writeFileSync(join(dir, 'b.txt'), 'wip\n')
    writeFileSync(join(dir, 'n.txt'), 'n\n')
    await git.stash('my work', true)
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('b\n')
    expect(existsSync(join(dir, 'n.txt'))).toBe(false)
    expect((await git.stashes()).map((s) => [s.index, s.message])).toEqual([[0, 'my work']])
    expect((await git.stashApply(0, false)).ok).toBe(true)
    expect(readFileSync(join(dir, 'n.txt'), 'utf8')).toBe('n\n')
    await git.stashDrop(0)
    expect(await git.stashes()).toEqual([])
    await git.dispose()
  })

  it('pushes to a remote, publishing a new branch, and pulls', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'clyde-remote-'))
    sh(remote, 'init', '-q', '--bare', '-b', 'main')
    const dir = repo()
    sh(dir, 'remote', 'add', 'origin', remote)
    const { git } = await service(dir)
    await git.push()
    let status = await git.status()
    expect(status.upstream).toBe('origin/main')
    writeFileSync(join(dir, 'b.txt'), 'pushed\n')
    await git.stageAll()
    await git.commit('Pushed', { amend: false })
    expect((await git.status()).ahead).toBe(1)
    await git.push()
    await git.fetch()
    status = await git.status()
    expect([status.ahead, status.behind]).toEqual([0, 0])
    expect((await git.pull()).ok).toBe(true)
    expect((await git.branches()).some((b) => b.remote && b.name === 'origin/main')).toBe(true)
    await git.dispose()
  })
})

describe('CheckpointService', () => {
  function db() {
    const d = openDatabase(':memory:')
    migrate(d)
    return d
  }

  it('records the working tree before a session and puts it back', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'b.txt'), 'uncommitted before the agent\n')
    writeFileSync(join(dir, 'mine.txt'), 'untracked before the agent\n')
    const checkpoints = new CheckpointService(db())
    const made = await checkpoints.create('s1', dir)
    expect(made?.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(await checkpoints.create('s1', dir)).toBeNull()
    // The user's index and working tree are untouched.
    expect(sh(dir, 'status', '--porcelain')).toBe(' M b.txt\n?? mine.txt'.trim())
    expect(sh(dir, 'for-each-ref', 'refs/clyde/checkpoints')).toContain('refs/clyde/checkpoints/s1')

    // The agent edits, creates and deletes.
    writeFileSync(join(dir, 'a.txt'), 'agent\n')
    writeFileSync(join(dir, 'agent.txt'), 'agent\n')
    rmSync(join(dir, 'mine.txt'))
    const changes = await checkpoints.changes(dir, 's1')
    expect(changes.map((c) => [c.path, c.state])).toEqual([
      ['a.txt', 'modified'],
      ['agent.txt', 'added'],
      ['mine.txt', 'deleted']
    ])

    const trash = vi.fn(async (abs: string) => rmSync(abs))
    expect(await checkpoints.restore(dir, 's1', trash)).toBe(3)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toContain('line 1\n')
    expect(readFileSync(join(dir, 'mine.txt'), 'utf8')).toBe('untracked before the agent\n')
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('uncommitted before the agent\n')
    expect(existsSync(join(dir, 'agent.txt'))).toBe(false)
    expect(await checkpoints.changes(dir, 's1')).toEqual([])
  })

  it('does nothing outside a repository', async () => {
    const checkpoints = new CheckpointService(db())
    expect(await checkpoints.create('s1', mkdtempSync(join(tmpdir(), 'clyde-nogit-')))).toBeNull()
  })

  it('knows which session wrote which file', () => {
    const d = db()
    const root = join(tmpdir(), 'proj')
    const now = Date.now()
    const insert = d.prepare(`INSERT INTO sessions (id, profile_id, profile_name, kind, cwd, status, started_at, title) VALUES (?, 'p1', 'P', 'claude-code', ?, 'stopped', ?, ?)`)
    insert.run('s1', root, now - 1000, 'First')
    insert.run('s2', join(root, 'sub'), now - 500, 'Second')
    insert.run('old', root, now - 90 * 86_400_000, 'Old')
    const event = d.prepare('INSERT INTO session_events (session_id, seq, at, event) VALUES (?, ?, ?, ?)')
    const call = (name: string, input: object) => JSON.stringify({ type: 'tool_call', toolUseId: 'x', name, input, parentToolUseId: null })
    event.run('s1', 1, now - 900, call('Write', { file_path: join(root, 'a.ts') }))
    event.run('s1', 2, now - 800, call('Read', { file_path: join(root, 'b.ts') }))
    event.run('s2', 1, now - 400, call('Edit', { changes: [{ path: 'c.ts' }, { path: join(root, 'a.ts') }] }))
    event.run('s2', 2, now - 300, call('write_file', { path: '../../outside.ts' }))
    event.run('old', 1, now - 90 * 86_400_000, call('Write', { file_path: join(root, 'a.ts') }))
    const map = new CheckpointService(d).fileSessions(root)
    expect(Object.keys(map).sort()).toEqual(['a.ts', 'sub/c.ts'])
    expect(map['a.ts']?.map((s) => s.sessionId)).toEqual(['s2', 's1'])
    expect(map['sub/c.ts']?.[0]?.title).toBe('Second')
  })

  it('reads the files of write tools', () => {
    expect(writtenPaths('Read', { file_path: 'a' })).toEqual([])
    expect(writtenPaths('NotebookEdit', { notebook_path: 'n.ipynb' })).toEqual(['n.ipynb'])
    expect(writtenPaths('Edit', { file_path: 'a', changes: [{ path: 'a' }, { path: 'b' }] })).toEqual(['a', 'b'])
  })
})
