import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listDir, readText, writeText } from './files'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clyde-files-'))
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, 'b.txt'), 'bee')
  writeFileSync(join(root, 'a10.txt'), '')
  writeFileSync(join(root, 'a2.txt'), '')
  writeFileSync(join(root, 'src', 'main.ts'), 'export {}\n')
  writeFileSync(join(root, 'img.bin'), Buffer.from([1, 2, 0, 3]))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('listDir', () => {
  it('lists directories first, natural order, hides .git', async () => {
    const names = (await listDir(root, '')).map((e) => e.name)
    expect(names).toEqual(['src', 'a2.txt', 'a10.txt', 'b.txt', 'img.bin'])
  })

  it('returns forward-slash relative paths', async () => {
    expect(await listDir(root, 'src')).toEqual([{ name: 'main.ts', path: 'src/main.ts', kind: 'file' }])
  })

  it('maps missing directories to not_found', async () => {
    await expect(listDir(root, 'nope')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('readText / writeText', () => {
  it('reads text and flags binary files', async () => {
    expect((await readText(root, 'b.txt')).content).toBe('bee')
    const bin = await readText(root, 'img.bin')
    expect(bin.unsupported).toBe('binary')
    expect(bin.content).toBe('')
  })

  it('writes inside the workspace and refuses to escape it', async () => {
    await writeText(root, 'src/main.ts', 'changed')
    expect((await readText(root, 'src/main.ts')).content).toBe('changed')
    await expect(writeText(root, '../evil.txt', 'x')).rejects.toMatchObject({ code: 'outside_workspace' })
  })
})
