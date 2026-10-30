import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { ToolImage } from '@shared/agent'
import { AppError } from '@shared/errors'
import { t } from '@shared/i18n'

/** Larger images are not kept: a screenshot is a few hundred kilobytes. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }
const MIME: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]))
MIME['jpeg'] = 'image/jpeg'

/** The image type of a file name, or null for anything that is not an image Clyde shows. */
export function imageMime(path: string): string | null {
  return MIME[extname(path).slice(1).toLowerCase()] ?? null
}

/** MCP image blocks (`{type: 'image', data, mimeType}`) of a tool result. */
export function mcpImages(content: readonly unknown[]): ToolImage[] {
  return content.flatMap((part) => {
    const p = part as { type?: string; data?: unknown; mimeType?: unknown }
    return p?.type === 'image' && typeof p.data === 'string' && typeof p.mimeType === 'string' ? [{ mime: p.mimeType, data: p.data }] : []
  })
}

/**
 * Images agents' tools return, kept on disk per session (`<root>/<session>/<hash>.<ext>`) so the
 * stored transcript only holds their ids. The same image twice is stored once.
 */
export class MediaStore {
  constructor(private readonly root: string) {}

  /** Stores the image and returns it with only its id; null when it cannot be kept. */
  save(sessionId: string, image: ToolImage): ToolImage | null {
    const ext = EXT[image.mime]
    if (!ext) return null
    let bytes: Buffer
    try {
      if (image.data) bytes = Buffer.from(image.data, 'base64')
      else if (image.path && statSync(image.path).size <= MAX_IMAGE_BYTES) bytes = readFileSync(image.path)
      else return null
    } catch {
      return null
    }
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null
    const id = `${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.${ext}`
    const dir = join(this.root, safe(sessionId))
    const file = join(dir, id)
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, bytes)
    }
    return { id, mime: image.mime }
  }

  read(sessionId: string, id: string): { mime: string; data: string } {
    const ext = /^[a-f0-9]{24}\.([a-z]+)$/.exec(id)?.[1]
    const mime = ext ? MIME[ext] : undefined
    const file = join(this.root, safe(sessionId), id)
    if (!mime || !existsSync(file)) throw new AppError('not_found', t('This image is no longer available'))
    return { mime, data: readFileSync(file).toString('base64') }
  }

  /** Forgets the images of every session but `keep` (Settings › Data › purge). */
  clear(keep: readonly string[] = []): void {
    let dirs: string[]
    try {
      dirs = readdirSync(this.root)
    } catch {
      return
    }
    for (const dir of dirs) if (!keep.includes(dir)) rmSync(join(this.root, dir), { recursive: true, force: true })
  }
}

/** Session ids are `as-<uuid>`; anything else cannot become a path. */
function safe(sessionId: string): string {
  if (!/^as-[a-z0-9-]{1,40}$/.test(sessionId)) throw new AppError('invalid_request', 'Invalid session id')
  return sessionId
}
