import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { redactSecrets } from '@shared/redact'

/**
 * The memory files. Atelier's own Markdown is the source of truth; the files each CLI reads
 * (CLAUDE.md, AGENTS.md, GEMINI.md) only get a managed block, between markers, that Atelier
 * rewrites. Everything outside the markers stays the user's.
 *
 * - Project memory: `<repo>/.atelier/memory/core.md`, plus detailed notes in `docs/*.md`.
 * - User memory: `<userData>/memory/core.md` and `docs/`; it reaches each account's own global
 *   file, never a repository (a project file may be committed).
 */

export const BLOCK_START = '<!-- atelier:memory -->'
export const BLOCK_END = '<!-- /atelier:memory -->'

export type { MemoryScope } from '@shared/memory'

export interface MemoryDoc {
  name: string
  /** First non-empty line, for the index the core points to. */
  title: string
  content: string
}

export function projectMemoryDir(repo: string): string {
  return join(repo, '.atelier', 'memory')
}

export function readCore(dir: string): string {
  const file = join(dir, 'core.md')
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

export function readDocs(dir: string): MemoryDoc[] {
  const docs = join(dir, 'docs')
  if (!existsSync(docs)) return []
  return readdirSync(docs)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((name) => {
      const content = readFileSync(join(docs, name), 'utf8')
      const title = content.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? name
      return { name, title, content }
    })
}

/** Writes Markdown with secrets masked: memory files are read by every agent and may be committed. */
export function writeMemoryFile(file: string, content: string): { redacted: boolean } {
  const clean = redactSecrets(content)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, clean.endsWith('\n') ? clean : `${clean}\n`)
  return { redacted: clean !== content }
}

export function deleteDoc(dir: string, name: string): void {
  rmSync(join(dir, 'docs', basename(name)), { force: true })
}

/** A doc file name from a title: "Release process" → "release-process.md". */
export function docFileName(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'note'}.md`
}

/**
 * The text of the managed block: the core, then the index of detailed notes with where to
 * find them, so an agent reads one only when it needs it.
 */
export function blockContent(core: string, docs: readonly MemoryDoc[], docsPath: string): string {
  const parts = [core.trim()]
  if (docs.length) {
    parts.push(
      [
        `Detailed notes, to read only when the task needs them (in ${docsPath}):`,
        ...docs.map((d) => `- ${d.name}: ${d.title}`)
      ].join('\n')
    )
  }
  return parts.filter(Boolean).join('\n\n')
}

/** Replaces (or appends) the managed block in a file's text; an empty block removes it. */
export function upsertBlock(text: string, content: string): string {
  const block = content.trim()
    ? `${BLOCK_START}\n<!-- Written by Atelier from its memory; edit it in Atelier, changes here are overwritten. -->\n${content.trim()}\n${BLOCK_END}`
    : ''
  const start = text.indexOf(BLOCK_START)
  const end = text.indexOf(BLOCK_END)
  if (start >= 0 && end > start) {
    const before = text.slice(0, start).replace(/\n+$/, '')
    const after = text.slice(end + BLOCK_END.length).replace(/^\n+/, '')
    return [before, block, after].filter(Boolean).join('\n\n') + '\n'
  }
  if (!block) return text
  return text.trim() ? `${text.replace(/\n+$/, '')}\n\n${block}\n` : `${block}\n`
}

/** Writes the block into a native file, creating it only when there is something to write. */
export function syncFile(file: string, content: string, create: boolean): boolean {
  const exists = existsSync(file)
  if (!exists && (!create || !content.trim())) return false
  const before = exists ? readFileSync(file, 'utf8') : ''
  const after = upsertBlock(before, content)
  if (after === before) return false
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, after)
  return true
}

/** Rough token count, as for the context gauge: about four characters per token. */
export function memoryTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
