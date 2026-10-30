import { describe, expect, it } from 'vitest'
import { afterClose, ancestors, visit } from './tab-history'

describe('tab history', () => {
  it('goes back to the tab viewed before the closed one', () => {
    let h: string[] = []
    for (const p of ['a', 'b', 'c', 'a']) h = visit(h, p)
    expect(h).toEqual(['b', 'c', 'a'])
    // Tabs in strip order a, b, c; viewing a, which was opened first: closing it shows c, viewed just before.
    expect(afterClose(h, ['a', 'b', 'c'], 'a', 'a')).toBe('c')
    // Closing another tab keeps the current one.
    expect(afterClose(h, ['a', 'b', 'c'], 'b', 'a')).toBe('a')
    // The last tab leaves nothing active.
    expect(afterClose(['a'], ['a'], 'a', 'a')).toBeNull()
    // Without history (a tab never viewed), a neighbour.
    expect(afterClose([], ['a', 'b', 'c'], 'b', 'b')).toBe('c')
  })

  it('lists the folders above a file', () => {
    expect(ancestors('src/main/index.ts')).toEqual(['src', 'src/main'])
    expect(ancestors('README.md')).toEqual([])
  })
})
