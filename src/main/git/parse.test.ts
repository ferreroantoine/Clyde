import { describe, expect, it } from 'vitest'
import { hunkPatch, parseBranches, parseDiff, parseLog, parseStashes, parseStatus } from './parse'

describe('parseStatus', () => {
  it('reads porcelain v2: branch, staged and unstaged sides, renames, deletions, untracked', () => {
    // Real output (`git status --porcelain=v2 -z --branch --untracked-files=all`), hashes shortened.
    const out = [
      '# branch.oid 608f4828',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 MM N... 100644 100644 100644 de98 7be7 a.txt',
      '2 R. N... 100644 100644 100644 3367 3367 R100 new.txt',
      'old.txt',
      '1 .D N... 100644 100644 000000 587b 587b with space.txt',
      '? untracked.txt',
      ''
    ].join('\0')
    expect(parseStatus(out)).toEqual({
      branch: 'main',
      head: '608f4828',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      staged: [
        { path: 'a.txt', oldPath: null, state: 'modified' },
        { path: 'new.txt', oldPath: 'old.txt', state: 'renamed' }
      ],
      unstaged: [
        { path: 'a.txt', oldPath: null, state: 'modified' },
        { path: 'with space.txt', oldPath: null, state: 'deleted' }
      ],
      untracked: [{ path: 'untracked.txt', oldPath: null, state: 'untracked' }],
      conflicts: [],
      truncated: false
    })
  })

  it('reads conflicts, a detached HEAD and a repository without commits', () => {
    const out = ['# branch.oid (initial)', '# branch.head (detached)', 'u UU N... 100644 100644 100644 100644 aaaa bbbb cccc src/x y.ts', ''].join('\0')
    const status = parseStatus(out)
    expect(status.head).toBeNull()
    expect(status.branch).toBeNull()
    expect(status.conflicts).toEqual([{ path: 'src/x y.ts', oldPath: null, state: 'conflicted' }])
  })

  it('stops listing past the limit and says so', () => {
    const out = ['? a', '? b', '? c', ''].join('\0')
    const status = parseStatus(out, 2)
    expect(status.untracked).toHaveLength(2)
    expect(status.truncated).toBe(true)
  })
})

describe('parseLog', () => {
  it('reads commits with parents and refs', () => {
    const out =
      ['abcdef1234', 'p1 p2', 'Ann', 'ann@x', '1700000000', 'Merge branch x', 'HEAD -> main, origin/main, tag: v1'].join('\x1f') +
      '\x1e\n' +
      ['p1', '', 'Bob', 'bob@x', '1690000000', 'init: a, b', ''].join('\x1f') +
      '\x1e\n'
    expect(parseLog(out)).toEqual([
      { hash: 'abcdef1234', short: 'abcdef1', parents: ['p1', 'p2'], author: 'Ann', email: 'ann@x', date: 1_700_000_000_000, subject: 'Merge branch x', refs: ['HEAD -> main', 'origin/main', 'tag: v1'] },
      { hash: 'p1', short: 'p1', parents: [], author: 'Bob', email: 'bob@x', date: 1_690_000_000_000, subject: 'init: a, b', refs: [] }
    ])
  })
})

describe('parseBranches', () => {
  it('reads local and remote branches, tracking and the current one; skips origin/HEAD', () => {
    const rec = (...f: string[]) => f.join('\x1f') + '\x1e\n'
    const out =
      rec('refs/heads/main', 'main', 'origin/main', 'ahead 1, behind 2', '*', '1700000000', 'abc1234') +
      rec('refs/heads/old', 'old', 'origin/old', 'gone', ' ', '1600000000', 'def5678') +
      rec('refs/remotes/origin/HEAD', 'origin', '', '', ' ', '1700000000', 'abc1234') +
      rec('refs/remotes/origin/main', 'origin/main', '', '', ' ', '1700000000', 'abc1234')
    expect(parseBranches(out)).toEqual([
      { name: 'main', remote: false, current: true, upstream: 'origin/main', ahead: 1, behind: 2, gone: false, date: 1_700_000_000_000, short: 'abc1234' },
      { name: 'old', remote: false, current: false, upstream: 'origin/old', ahead: 0, behind: 0, gone: true, date: 1_600_000_000_000, short: 'def5678' },
      { name: 'origin/main', remote: true, current: false, upstream: null, ahead: 0, behind: 0, gone: false, date: 1_700_000_000_000, short: 'abc1234' }
    ])
  })
})

describe('parseStashes', () => {
  it('reads index, date and message', () => {
    const out = 'stash@{0}\x1f1700000000\x1fOn main: wip login\x1e\nstash@{1}\x1f1690000000\x1fWIP on main: abc init\x1e\n'
    expect(parseStashes(out)).toEqual([
      { index: 0, message: 'wip login', date: 1_700_000_000_000 },
      { index: 1, message: 'WIP on main: abc init', date: 1_690_000_000_000 }
    ])
  })
})

describe('parseDiff', () => {
  const out = [
    'diff --git a/a.txt b/a.txt',
    'index 1111..2222 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1,3 +1,3 @@',
    ' a',
    '-b',
    '+B',
    ' c',
    '@@ -10 +10,2 @@ function x',
    ' j',
    '+k',
    '\\ No newline at end of file',
    ''
  ].join('\n')

  it('splits the header from the hunks', () => {
    const diff = parseDiff(out)
    expect(diff.header).toHaveLength(4)
    expect(diff.binary).toBe(false)
    expect(diff.hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines, h.lines.length])).toEqual([
      [1, 3, 1, 3, 4],
      [10, 1, 10, 2, 3]
    ])
  })

  it('builds a patch of one hunk', () => {
    expect(hunkPatch(parseDiff(out), 1)).toBe(['diff --git a/a.txt b/a.txt', 'index 1111..2222 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -10 +10,2 @@ function x', ' j', '+k', '\\ No newline at end of file', ''].join('\n'))
    expect(hunkPatch(parseDiff(out), 5)).toBeNull()
  })

  it('knows binary files', () => {
    expect(parseDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n').binary).toBe(true)
  })
})
