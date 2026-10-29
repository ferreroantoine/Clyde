import { t } from '@shared/i18n'
import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import type { DirEntry, FileContent } from '@shared/types'
import { resolveInside, toRel } from './paths'

const MAX_TEXT_BYTES = 5 * 1024 * 1024
const SNIFF_BYTES = 8000
const HIDDEN = new Set(['.git'])

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function ioError(err: unknown, rel: string): AppError {
  const code = (err as NodeJS.ErrnoException)?.code
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

export async function writeText(root: string, rel: string, content: string): Promise<{ mtimeMs: number }> {
  const abs = resolveInside(root, rel)
  try {
    await writeFile(abs, content, 'utf8')
    return { mtimeMs: (await stat(abs)).mtimeMs }
  } catch (err) {
    throw ioError(err, rel)
  }
}
