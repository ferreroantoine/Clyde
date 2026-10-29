import { spawn } from 'node:child_process'
import { rgPath } from '@vscode/ripgrep'
import { AppError } from '@shared/errors'
import type { SearchMatch, SearchResult } from '@shared/types'

export interface SearchOptions {
  query: string
  caseSensitive: boolean
  regex: boolean
  maxResults: number
}

const PREVIEW_MAX = 240

export function ripgrepArgs(opts: SearchOptions): string[] {
  return [
    '--json',
    '--max-columns',
    '1000',
    '--max-filesize',
    '5M',
    opts.caseSensitive ? '--case-sensitive' : '--ignore-case',
    ...(opts.regex ? [] : ['--fixed-strings']),
    '--',
    opts.query,
    '.'
  ]
}

interface RgMatchLine {
  type: 'match'
  data: {
    path: { text?: string }
    lines: { text?: string }
    line_number: number
    submatches: Array<{ start: number; end: number }>
  }
}

/** Parses one `rg --json` line into matches; rg reports byte offsets, Monaco wants UTF-16 columns. */
export function parseRipgrepLine(line: string): SearchMatch[] {
  if (!line.startsWith('{"type":"match"')) return []
  const msg = JSON.parse(line) as RgMatchLine
  const { path, lines, line_number, submatches } = msg.data
  if (path.text === undefined || lines.text === undefined) return []
  const text = lines.text.replace(/\r?\n$/, '')
  const bytes = Buffer.from(text, 'utf8')
  const rel = path.text.replace(/^\.[\\/]/, '').replaceAll('\\', '/')
  return submatches.map((m) => {
    const column = bytes.subarray(0, m.start).toString('utf8').length
    const matchLength = bytes.subarray(m.start, m.end).toString('utf8').length
    const start = Math.max(0, column - 40)
    const prefix = start > 0 ? '…' : ''
    return {
      path: rel,
      line: line_number,
      column: column + 1,
      matchLength,
      preview: prefix + text.slice(start, start + PREVIEW_MAX).trimEnd(),
      previewStart: prefix.length + column - start
    }
  })
}

export function searchText(root: string, opts: SearchOptions): Promise<SearchResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, ripgrepArgs(opts), { cwd: root, windowsHide: true })
    const matches: SearchMatch[] = []
    let truncated = false
    let buffer = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (truncated) continue
        for (const m of parseRipgrepLine(line)) {
          if (matches.length >= opts.maxResults) {
            truncated = true
            child.kill()
            break
          }
          matches.push(m)
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => reject(new AppError('search_error', `ripgrep failed to start: ${err.message}`)))
    child.on('close', (code) => {
      // 0 = matches, 1 = no match, null = killed after hitting the limit.
      if (code === 0 || code === 1 || truncated) resolve({ matches, truncated })
      else reject(new AppError('search_error', stderr.trim().split('\n')[0] || `ripgrep exited with ${code}`))
    })
  })
}

const MAX_FILES = 20_000

/** Workspace files for "Go to file", as `/`-separated relative paths. Respects .gitignore like rg does. */
export function listFiles(root: string, max = MAX_FILES): Promise<{ files: string[]; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, ['--files', '--hidden', '--glob', '!.git', '--no-messages'], { cwd: root, windowsHide: true })
    const files: string[] = []
    let rest = ''
    let truncated = false
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const lines = (rest + chunk).split(/\r?\n/)
      rest = lines.pop() ?? ''
      for (const line of lines) {
        if (files.length >= max) {
          truncated = true
          child.kill()
          return
        }
        if (line) files.push(line.replace(/\\/g, '/'))
      }
    })
    child.on('error', (err) => reject(new AppError('search_error', `Could not list files: ${err.message}`)))
    child.on('close', () => {
      if (rest && files.length < max) files.push(rest.replace(/\\/g, '/'))
      resolve({ files: files.sort(), truncated })
    })
  })
}
