import { t } from '@shared/i18n'
import { cp, lstat, mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { AppError } from '@shared/errors'
import type { DirEntry, FileContent } from '@shared/types'
import { resolveInside, toRel } from './paths'

const MAX_TEXT_BYTES = 5 * 1024 * 1024
const SNIFF_BYTES = 8000
const HIDDEN = new Set(['.git'])

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function ioError(err: unknown, rel: string): AppError {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'EEXIST') return new AppError('already_exists', t('Already exists: {rel}', { rel }))
  if (code === 'ENOENT') return new AppError('not_found', t('Not found: {path}', { path: rel || '/' }))
  if (code === 'EACCES' || code === 'EPERM') return new AppError('io_error', t('Permission denied: {rel}', { rel }))
  return new AppError('io_error', (err as Error)?.message ?? t('I/O error on {rel}', { rel }))
}

export async function listDir(root: string, rel: string): Promise<DirEntry[]> {
  const abs = resolveInside(root, rel)
  try {
    const dirents = await readdir(abs, { withFileTypes: true })
    return dirents
      .filter((d) => !HIDDEN.has(d.name) && (d.isDirectory() || d.isFile() || d.isSymbolicLink()))
      .map<DirEntry>((d) => ({
        name: d.name,
        path: toRel(root, join(abs, d.name)),
        kind: d.isDirectory() ? 'dir' : 'file'
      }))
      .sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1))
  } catch (err) {
    throw ioError(err, rel)
  }
}

async function looksBinary(abs: string): Promise<boolean> {
  const handle = await open(abs, 'r')
  try {
    const buf = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } finally {
    await handle.close()
  }
}

export async function readText(root: string, rel: string): Promise<FileContent> {
  const abs = resolveInside(root, rel)
  try {
    const info = await stat(abs)
    if (!info.isFile()) throw new AppError('io_error', t('Not a file: {rel}', { rel }))
    const base = { path: rel, size: info.size, mtimeMs: info.mtimeMs }
    if (info.size > MAX_TEXT_BYTES) return { ...base, content: '', unsupported: 'too-large' }
    if (await looksBinary(abs)) return { ...base, content: '', unsupported: 'binary' }
    return { ...base, content: await readFile(abs, 'utf8'), unsupported: null }
  } catch (err) {
    throw err instanceof AppError ? err : ioError(err, rel)
  }
}

/** Size and modification time, for the viewers that read the bytes themselves. */
export async function statFile(root: string, rel: string): Promise<{ size: number; mtimeMs: number }> {
  const abs = resolveInside(root, rel)
  try {
    const info = await stat(abs)
    if (!info.isFile()) throw new AppError('io_error', t('Not a file: {rel}', { rel }))
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch (err) {
    throw err instanceof AppError ? err : ioError(err, rel)
  }
}

export async function writeText(root: string, rel: string, content: string): Promise<{ mtimeMs: number }> {
  const abs = resolveInside(root, rel)
  try {
    await writeFile(abs, content, 'utf8')
    return { mtimeMs: (await stat(abs)).mtimeMs }
  } catch (err) {
    throw ioError(err, rel)
  }
}

/** Like `resolveInside`, but also refuses the workspace root itself. */
function resolveEntry(root: string, rel: string): string {
  const abs = resolveInside(root, rel)
  if (abs === resolveInside(root, '')) throw new AppError('outside_workspace', t('Invalid path'))
  return abs
}

async function exists(abs: string): Promise<boolean> {
  return lstat(abs).then(
    () => true,
    () => false
  )
}

async function entryOf(root: string, abs: string): Promise<DirEntry> {
  const info = await stat(abs)
  return { name: basename(abs), path: toRel(root, abs), kind: info.isDirectory() ? 'dir' : 'file' }
}

/** Creates an empty file, and its missing parent directories; never overwrites. */
export async function createFile(root: string, rel: string): Promise<DirEntry> {
  const abs = resolveEntry(root, rel)
  try {
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, '', { flag: 'wx' })
    return await entryOf(root, abs)
  } catch (err) {
    throw ioError(err, rel)
  }
}

export async function createDir(root: string, rel: string): Promise<DirEntry> {
  const abs = resolveEntry(root, rel)
  if (await exists(abs)) throw ioError(Object.assign(new Error(), { code: 'EEXIST' }), rel)
  try {
    await mkdir(abs, { recursive: true })
    return await entryOf(root, abs)
  } catch (err) {
    throw ioError(err, rel)
  }
}

/** Moves a file or directory; refuses to replace another entry, but allows a change of case. */
export async function renamePath(root: string, from: string, to: string): Promise<DirEntry> {
  const src = resolveEntry(root, from)
  const dest = resolveEntry(root, to)
  const sameEntry = src.toLowerCase() === dest.toLowerCase()
  if (!sameEntry && (await exists(dest))) throw ioError(Object.assign(new Error(), { code: 'EEXIST' }), to)
  try {
    await mkdir(dirname(dest), { recursive: true })
    await rename(src, dest)
    return await entryOf(root, dest)
  } catch (err) {
    throw ioError(err, from)
  }
}

/** Copies a file or directory next to itself: `name copy.ext`, then `name copy 2.ext`… */
export async function duplicate(root: string, rel: string): Promise<DirEntry> {
  const src = resolveEntry(root, rel)
  try {
    const isDir = (await stat(src)).isDirectory()
    const name = basename(src)
    // `extname('.env')` is empty, so dotfiles stay whole.
    const ext = isDir ? '' : extname(name)
    const stem = name.slice(0, name.length - ext.length)
    let dest = join(dirname(src), `${stem} copy${ext}`)
    for (let n = 2; await exists(dest); n++) dest = join(dirname(src), `${stem} copy ${n}${ext}`)
    await cp(src, dest, { recursive: true, errorOnExist: true, force: false })
    return await entryOf(root, dest)
  } catch (err) {
    throw ioError(err, rel)
  }
}
