import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInside, resolveInside, toRel } from './paths'

const root = resolve('/work/repo')

describe('resolveInside', () => {
  it('resolves paths inside the root', () => {
    expect(resolveInside(root, 'src/a.ts')).toBe(join(root, 'src', 'a.ts'))
    expect(resolveInside(root, '')).toBe(root)
    expect(resolveInside(root, 'src/../b.ts')).toBe(join(root, 'b.ts'))
  })

  it('rejects traversal, absolute paths and NUL bytes', () => {
    expect(() => resolveInside(root, '../secret')).toThrow(/outside the workspace/)
    expect(() => resolveInside(root, 'src/../../x')).toThrow(/outside the workspace/)
    expect(() => resolveInside(root, resolve('/etc/passwd'))).toThrow(/outside the workspace/)
    expect(() => resolveInside(root, 'a\0b')).toThrow(/Invalid path/)
  })

  it('does not treat a sibling with the same prefix as inside', () => {
    expect(isInside(root, resolve('/work/repo-other/file'))).toBe(false)
  })
})

describe('toRel', () => {
  it('uses forward slashes', () => {
    expect(toRel(root, join(root, 'src', 'deep', 'f.ts'))).toBe('src/deep/f.ts')
  })
})
