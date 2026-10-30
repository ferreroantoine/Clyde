import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDir, createFile, duplicate, listDir, readText, renamePath, writeText } from './files'

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

describe('createFile / createDir', () => {
  it('creates an empty file and returns its entry', async () => {
    expect(await createFile(root, 'src/new.ts')).toEqual({ name: 'new.ts', path: 'src/new.ts', kind: 'file' })
    expect(readFileSync(join(root, 'src', 'new.ts'), 'utf8')).toBe('')
  })

  it('creates a directory and its missing parents', async () => {
    expect(await createDir(root, 'a/b')).toEqual({ name: 'b', path: 'a/b', kind: 'dir' })
    expect(existsSync(join(root, 'a', 'b'))).toBe(true)
  })

  it('refuses to overwrite an existing entry', async () => {
    await expect(createFile(root, 'b.txt')).rejects.toMatchObject({ code: 'already_exists' })
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('bee')
    await expect(createDir(root, 'src')).rejects.toMatchObject({ code: 'already_exists' })
  })

  it('refuses to escape the workspace', async () => {
    await expect(createFile(root, '../evil.txt')).rejects.toMatchObject({ code: 'outside_workspace' })
    await expect(createDir(root, '../evil')).rejects.toMatchObject({ code: 'outside_workspace' })
  })
})

describe('renamePath', () => {
  it('renames a file', async () => {
    expect(await renamePath(root, 'b.txt', 'c.txt')).toEqual({ name: 'c.txt', path: 'c.txt', kind: 'file' })
    expect(existsSync(join(root, 'b.txt'))).toBe(false)
    expect(readFileSync(join(root, 'c.txt'), 'utf8')).toBe('bee')
  })

  it('renames a directory', async () => {
    expect(await renamePath(root, 'src', 'lib')).toEqual({ name: 'lib', path: 'lib', kind: 'dir' })
    expect(existsSync(join(root, 'lib', 'main.ts'))).toBe(true)
  })

  it('refuses to replace an existing entry', async () => {
    await expect(renamePath(root, 'b.txt', 'a2.txt')).rejects.toMatchObject({ code: 'already_exists' })
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('bee')
  })

  it('allows a change of case only', async () => {
    expect((await renamePath(root, 'b.txt', 'B.txt')).path).toBe('B.txt')
    expect((await listDir(root, '')).map((e) => e.name)).toContain('B.txt')
  })

  it('refuses to escape the workspace', async () => {
    await expect(renamePath(root, 'b.txt', '../b.txt')).rejects.toMatchObject({ code: 'outside_workspace' })
    await expect(renamePath(root, '', 'x')).rejects.toMatchObject({ code: 'outside_workspace' })
  })
})

describe('duplicate', () => {
  it('copies a file next to itself with a free name', async () => {
    expect(await duplicate(root, 'b.txt')).toEqual({ name: 'b copy.txt', path: 'b copy.txt', kind: 'file' })
    expect((await duplicate(root, 'b.txt')).name).toBe('b copy 2.txt')
    expect(readFileSync(join(root, 'b copy 2.txt'), 'utf8')).toBe('bee')
  })

  it('copies a directory recursively', async () => {
    expect(await duplicate(root, 'src')).toEqual({ name: 'src copy', path: 'src copy', kind: 'dir' })
    expect(readFileSync(join(root, 'src copy', 'main.ts'), 'utf8')).toBe('export {}\n')
  })

  it('keeps dotfiles whole', async () => {
    writeFileSync(join(root, '.env'), 'X=1')
    expect((await duplicate(root, '.env')).name).toBe('.env copy')
  })

  it('refuses the workspace root', async () => {
    await expect(duplicate(root, '')).rejects.toMatchObject({ code: 'outside_workspace' })
  })
})
