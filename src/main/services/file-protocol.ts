import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { resolveInside } from './paths'

/**
 * `clyde-file://workspace/<path>`: the bytes of a file of the open folder, for the viewers
 * (images, PDF, audio and video) without going through IPC and base64. Nothing outside the
 * folder is served, and ranges are answered so media can seek.
 */
export const FILE_SCHEME = 'clyde-file'
const HOST = 'workspace'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet'
}

export function mimeOf(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** The workspace-relative path in a `clyde-file://workspace/…` URL, or null for any other URL. */
export function pathOfUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${FILE_SCHEME}:` || parsed.hostname !== HOST) return null
  try {
    return parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part))
      .join('/')
  } catch {
    return null
  }
}

/** `bytes=a-b`, `bytes=a-`, `bytes=-n` against a file of `size` bytes; null when unusable. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  if (m[1] === '') {
    const n = Number(m[2])
    if (n === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}

export interface FileReply {
  status: number
  headers: Record<string, string>
  /** The file's bytes (or the asked range); absent for errors and HEAD. */
  body?: { abs: string; start: number; end: number }
}

/**
 * The page is a file:// document, another origin: fetch() (pdf.js, Word, spreadsheets) needs
 * these. Only Clyde's own window loads this scheme, so any origin may read.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'content-length, content-range, accept-ranges'
}

/** What to answer to one request, without reading the file yet. */
export async function replyFor(root: string | null, url: string, method: string, range: string | null): Promise<FileReply> {
  const reply = await bareReply(root, url, method, range)
  return { ...reply, headers: { ...CORS, ...reply.headers } }
}

async function bareReply(root: string | null, url: string, method: string, range: string | null): Promise<FileReply> {
  if (method === 'OPTIONS') return { status: 204, headers: { 'access-control-allow-methods': 'GET, HEAD' } }
  const rel = pathOfUrl(url)
  if (!root || rel === null) return { status: 404, headers: {} }
  let abs: string
  try {
    abs = resolveInside(root, rel)
  } catch {
    return { status: 403, headers: {} }
  }
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) return { status: 404, headers: {} }
  const size = info.size
  const base = { 'content-type': mimeOf(abs), 'accept-ranges': 'bytes', 'cache-control': 'no-cache' }
  const asked = parseRange(range, size)
  if (asked === 'unsatisfiable') return { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } }
  const { start, end } = asked ?? { start: 0, end: size - 1 }
  const headers = {
    ...base,
    'content-length': String(size === 0 ? 0 : end - start + 1),
    ...(asked ? { 'content-range': `bytes ${start}-${end}/${size}` } : {})
  }
  const status = asked ? 206 : 200
  if (method === 'HEAD' || size === 0) return { status, headers }
  return { status, headers, body: { abs, start, end } }
}

/** The protocol handler: `protocol.handle(FILE_SCHEME, fileHandler(() => workspace.root))`. */
export function fileHandler(root: () => string | null): (request: Request) => Promise<Response> {
  return async (request) => {
    const reply = await replyFor(root(), request.url, request.method, request.headers.get('range'))
    const body = reply.body
      ? (Readable.toWeb(createReadStream(reply.body.abs, { start: reply.body.start, end: reply.body.end })) as ReadableStream<Uint8Array>)
      : null
    return new Response(body, { status: reply.status, headers: reply.headers })
  }
}
