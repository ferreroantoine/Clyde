import { describe, expect, it } from 'vitest'
import { parseRipgrepLine, ripgrepArgs } from './search'

const matchLine = (text: string, start: number, end: number, path = './src\\a.ts') =>
  JSON.stringify({
    type: 'match',
    data: { path: { text: path }, lines: { text }, line_number: 7, submatches: [{ start, end }] }
  })

describe('parseRipgrepLine', () => {
  it('ignores non-match messages', () => {
    expect(parseRipgrepLine('{"type":"begin","data":{}}')).toEqual([])
  })

  it('normalizes the path and converts byte offsets to columns', () => {
    // "é" is 2 bytes in UTF-8 but one UTF-16 unit.
    const [m] = parseRipgrepLine(matchLine('const é = foo\n', 11, 14))
    expect(m).toMatchObject({
      path: 'src/a.ts',
      line: 7,
      column: 11,
      matchLength: 3,
      preview: 'const é = foo',
      previewStart: 10
    })
  })

  it('crops long lines and keeps the match offset inside the preview', () => {
    const text = 'x'.repeat(100) + 'needle'
    const [m] = parseRipgrepLine(matchLine(text, 100, 106))
    expect(m?.preview.startsWith('…')).toBe(true)
    expect(m?.preview.slice(m.previewStart, m.previewStart + m.matchLength)).toBe('needle')
  })
})

describe('ripgrepArgs', () => {
  it('uses fixed strings unless regex is requested and ends the options before the query', () => {
    const args = ripgrepArgs({ query: '-x', caseSensitive: false, regex: false, maxResults: 10 })
    expect(args).toContain('--fixed-strings')
    expect(args).toContain('--ignore-case')
    expect(args.slice(-3)).toEqual(['--', '-x', '.'])
    expect(ripgrepArgs({ query: 'a.+', caseSensitive: true, regex: true, maxResults: 1 })).not.toContain(
      '--fixed-strings'
    )
  })
})

describe('listFiles', () => {
  it('lists files with / separators, skipping .git and ignored files', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { listFiles } = await import('./search')
    const root = mkdtempSync(join(tmpdir(), 'atelier-files-'))
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'HEAD'), 'x')
    writeFileSync(join(root, 'src', 'a.ts'), '')
    writeFileSync(join(root, '.gitignore'), 'build/\n')
    mkdirSync(join(root, 'build'))
    writeFileSync(join(root, 'build', 'out.js'), '')
    writeFileSync(join(root, 'b.md'), '')
    expect(await listFiles(root)).toEqual({ files: ['.gitignore', 'b.md', 'src/a.ts'], truncated: false })
    expect((await listFiles(root, 1)).truncated).toBe(true)
  })
})
