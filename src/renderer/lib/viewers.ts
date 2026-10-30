/**
 * Which viewer shows a file, from its extension. Text formats with a preview (Markdown, SVG,
 * tables, JSON) also open in the code editor; the others are read as bytes through
 * clyde-file:// and shown by their viewer only.
 */
export type ViewerKind = 'markdown' | 'svg' | 'table' | 'json' | 'image' | 'pdf' | 'audio' | 'video' | 'docx' | 'sheet' | 'text'

const BY_EXTENSION: Record<string, ViewerKind> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  svg: 'svg',
  csv: 'table',
  tsv: 'table',
  json: 'json',
  jsonl: 'json',
  geojson: 'json',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  pdf: 'pdf',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  flac: 'audio',
  m4a: 'audio',
  aac: 'audio',
  opus: 'audio',
  mp4: 'video',
  m4v: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  ogv: 'video',
  docx: 'docx',
  xlsx: 'sheet',
  xls: 'sheet',
  ods: 'sheet'
}

export function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  // ".env" is a name, not an extension.
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function viewerFor(path: string): ViewerKind {
  return BY_EXTENSION[extensionOf(path)] ?? 'text'
}

/** Text the code editor opens too, with a preview / code switch. */
export function hasTextPreview(kind: ViewerKind): boolean {
  return kind === 'markdown' || kind === 'svg' || kind === 'table' || kind === 'json'
}

/** Shown from the file's bytes, never in the code editor. */
export function isBinaryViewer(kind: ViewerKind): boolean {
  return kind === 'image' || kind === 'pdf' || kind === 'audio' || kind === 'video' || kind === 'docx' || kind === 'sheet'
}

/** The URL main serves a workspace file at (see main/services/file-protocol.ts). */
export function fileUrl(path: string, version?: number): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `clyde-file://workspace/${encoded}${version !== undefined ? `?v=${Math.round(version)}` : ''}`
}

/** `target` (a link or image in a Markdown file) as a workspace path, or null when it points elsewhere. */
export function resolveRelative(fromFile: string, target: string): string | null {
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#')) return null
  const clean = target.split(/[?#]/)[0] ?? ''
  let decoded: string
  try {
    decoded = decodeURIComponent(clean)
  } catch {
    decoded = clean
  }
  const parts = decoded.startsWith('/') ? [] : fromFile.split('/').slice(0, -1)
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(part)
  }
  return parts.length ? parts.join('/') : null
}

/** "1.2 MB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
