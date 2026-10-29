import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { branchSlug, parseNameStatus, WorktreeService } from './worktrees'

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'clyde-repo-'))
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 'me@example.com')
  sh(dir, 'config', 'user.name', 'Me')
  // Git for Windows checks files out with CRLF by default; the assertions compare exact bytes.
  sh(dir, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(dir, 'old.txt'), 'bye\n')
  sh(dir, 'add', '.')
  sh(dir, 'commit', '-q', '-m', 'init')
  const service = new WorktreeService(mkdtempSync(join(tmpdir(), 'clyde-wt-')))
  return { dir, service }
}

describe('branchSlug', () => {
  it('makes short ASCII slugs that stay unique per task', () => {
    expect(branchSlug('Ajouter la page « Réglages » !', 'ab12cd34-0000-0000-0000-000000000000')).toBe('ajouter-la-page-reglages-ab12cd')
    expect(branchSlug('???', '12345678-aaaa')).toBe('task-123456')
  })
})

describe('parseNameStatus', () => {
  it('reads renames and plain changes', () => {
    expect(parseNameStatus('M\0a.txt\0R100\0old.txt\0new.txt\0A\0b.txt\0')).toEqual([
      { path: 'a.txt', oldPath: null, status: 'modified' },
      { path: 'b.txt', oldPath: null, status: 'added' },
      { path: 'new.txt', oldPath: 'old.txt', status: 'renamed' }
    ])
  })
})

describe('WorktreeService', () => {
  it('creates a worktree on its own branch, outside the repository', async () => {
    const { dir, service } = repo()
    expect(await service.isRepo(dir)).toBe(true)
    expect(await service.currentBranch(dir)).toBe('main')
    const ref = await service.create(dir, 'main', 'feature-1')
    expect(ref.branch).toBe('clyde/feature-1')
    expect(ref.worktreePath.startsWith(dir)).toBe(false)
    expect(readFileSync(join(ref.worktreePath, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(sh(ref.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('clyde/feature-1')
  })

  it('lists committed, uncommitted and untracked changes with both versions', async () => {
    const { dir, service } = repo()
    const ref = await service.create(dir, 'main', 'feature-2')
    writeFileSync(join(ref.worktreePath, 'a.txt'), 'one\n2\n')
    sh(ref.worktreePath, 'commit', '-qam', 'agent commit')
    writeFileSync(join(ref.worktreePath, 'b.txt'), 'new file\n')
    sh(ref.worktreePath, 'rm', '-q', 'old.txt')
    const changes = await service.changes(ref)
    expect(changes).toEqual([
      { path: 'a.txt', oldPath: null, status: 'modified' },
      { path: 'b.txt', oldPath: null, status: 'added' },
      { path: 'old.txt', oldPath: null, status: 'deleted' }
    ])
    const [modified, , deleted] = changes
    if (!modified || !deleted) throw new Error('missing changes')
    expect(await service.fileDiff(ref, modified)).toEqual({ path: 'a.txt', original: 'one\ntwo\n', modified: 'one\n2\n', unsupported: false })
    expect(await service.fileDiff(ref, deleted)).toMatchObject({ original: 'bye\n', modified: '' })
    // The main folder is untouched until the merge.
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  })

  it('merges with --no-ff, then removes the worktree and the branch', async () => {
    const { dir, service } = repo()
    const ref = await service.create(dir, 'main', 'feature-3')
    writeFileSync(join(ref.worktreePath, 'b.txt'), 'from the agent\n')
    const result = await service.merge(ref, 'Add b')
    expect(result).toMatchObject({ ok: true })
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('from the agent\n')
    expect(sh(dir, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2)
    expect(existsSync(ref.worktreePath)).toBe(false)
    expect(sh(dir, 'branch', '--list', 'clyde/*')).toBe('')
  })

  it('aborts a conflicting merge and reports the files', async () => {
    const { dir, service } = repo()
    const ref = await service.create(dir, 'main', 'feature-4')
    writeFileSync(join(ref.worktreePath, 'a.txt'), 'agent version\n')
    writeFileSync(join(dir, 'a.txt'), 'my version\n')
    sh(dir, 'commit', '-qam', 'mine')
    const result = await service.merge(ref, 'Change a')
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/conflicts in 1 file/), conflicts: ['a.txt'] })
    expect(sh(dir, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('my version\n')
    expect(existsSync(ref.worktreePath)).toBe(true)
  })

  it('refuses to merge into another branch than the base, or with nothing to merge', async () => {
    const { dir, service } = repo()
    const ref = await service.create(dir, 'main', 'feature-5')
    expect(await service.merge(ref, 'Nothing')).toMatchObject({ ok: false, reason: expect.stringMatching(/changed nothing/) })
    writeFileSync(join(ref.worktreePath, 'c.txt'), 'c\n')
    sh(dir, 'checkout', '-q', '-b', 'other')
    expect(await service.merge(ref, 'Add c')).toMatchObject({ ok: false, reason: expect.stringMatching(/Check out main/) })
  })

  it('abandons a task by deleting the worktree and the branch', async () => {
    const { dir, service } = repo()
    const ref = await service.create(dir, 'main', 'feature-6')
    writeFileSync(join(ref.worktreePath, 'x.txt'), 'x\n')
    await service.remove(ref, { deleteBranch: true })
    await service.remove(ref, { deleteBranch: true })
    expect(existsSync(ref.worktreePath)).toBe(false)
    expect(sh(dir, 'worktree', 'list').split('\n')).toHaveLength(1)
    expect(sh(dir, 'branch', '--list', 'clyde/*')).toBe('')
  })
})
