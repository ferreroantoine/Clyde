import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ToolRequest } from '../../permissions/engine'
import type { ToolSpec } from './chat'

export const MAX_OUTPUT_CHARS = 30_000
const MAX_READ_BYTES = 512 * 1024
const MAX_LIST_ENTRIES = 500
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'out', '.next', 'target'])

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})

/** Clyde's built-in tools for API agents, as the spec lists them. */
export const BASE_TOOLS: ToolSpec[] = [
  {
    name: 'read_file',
    description: 'Read a text file. Paths are relative to the working directory.',
    inputSchema: obj(
      {
        path: { type: 'string', description: 'File path' },
        offset: { type: 'integer', description: 'First line to return, 1-based' },
        limit: { type: 'integer', description: 'Maximum number of lines' }
      },
      ['path']
    )
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content. Parent folders are created.',
    inputSchema: obj({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content'])
  },
  {
    name: 'edit_file',
    description:
      'Replace an exact piece of text in a file. old_text must appear exactly once unless replace_all is true. Prefer this to rewriting whole files.',
    inputSchema: obj(
      {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' },
        replace_all: { type: 'boolean' }
      },
      ['path', 'old_text', 'new_text']
    )
  },
  {
    name: 'list_files',
    description: 'List files and folders as a tree. Skips .git, node_modules and build folders.',
    inputSchema: obj(
      {
        path: { type: 'string', description: 'Folder, default the working directory' },
        depth: { type: 'integer', description: 'How deep to go, 1 to 5, default 2' }
      },
      []
    )
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in the working directory and return its output and exit code. PowerShell on Windows, bash elsewhere.',
    inputSchema: obj(
      {
        command: { type: 'string' },
        timeout_seconds: { type: 'integer', description: 'Default 120, at most 600' }
      },
      ['command']
    )
  }
]

export const ASK_USER = 'ask_user'

/** Multiple-choice questions to the user, as Claude Code's AskUserQuestion; answered in the agent panel. */
export const ASK_USER_SPEC: ToolSpec = {
  name: ASK_USER,
  description:
    'Ask the user one to four multiple-choice questions when a decision is theirs to make: an approach, a library, a scope. The user can also type their own answer. Prefer this to asking in plain text when the choices are clear.',
  inputSchema: obj(
    {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: obj(
          {
            question: { type: 'string', description: 'The full question, ending with a question mark' },
            header: { type: 'string', description: 'A very short tag for the question, 12 characters at most' },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
              description: 'Distinct choices; do not add an "Other" choice, the user always has one',
              items: obj({ label: { type: 'string', description: '1 to 5 words' }, description: { type: 'string', description: 'What choosing it means' } }, ['label', 'description'])
            },
            multiSelect: { type: 'boolean', description: 'True when several choices can be picked' }
          },
          ['question', 'header', 'options', 'multiSelect']
        )
      }
    },
    ['questions']
  )
}

const str = (input: Record<string, unknown>, key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')

/** Expresses a base tool call in the permission engine's terms, so every level applies unchanged. */
export function toEngineRequest(name: string, input: Record<string, unknown>, platform: NodeJS.Platform): ToolRequest {
  switch (name) {
    case 'read_file':
      return { name: 'Read', input: { file_path: str(input, 'path') } }
    case 'write_file':
      return { name: 'Write', input: { file_path: str(input, 'path') } }
    case 'edit_file':
      return { name: 'Edit', input: { file_path: str(input, 'path') } }
    case 'list_files':
      return { name: 'LS', input: str(input, 'path') ? { path: str(input, 'path') } : {} }
    case 'run_command':
      return { name: platform === 'win32' ? 'PowerShell' : 'Bash', input: { command: str(input, 'command') } }
    default:
      return { name, input }
  }
}

export interface ToolOutput {
  content: string
  isError: boolean
}

export interface Shell {
  file: string
  args: (command: string) => string[]
}

/** pwsh, then Windows PowerShell on Windows; bash (or sh) elsewhere. */
export function defaultShell(platform: NodeJS.Platform, pwshAvailable: boolean): Shell {
  if (platform === 'win32') {
    return {
      file: pwshAvailable ? 'pwsh.exe' : 'powershell.exe',
      args: (command) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
    }
  }
  return { file: existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh', args: (command) => ['-c', command] }
}

/** Keeps the end of long output, where errors and summaries usually are. */
export function clip(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text
  return `[… ${text.length - max} characters cut]\n${text.slice(-max)}`
}

export class BaseToolExecutor {
  constructor(
    private readonly cwd: string,
    private readonly shell: Shell,
    private readonly env: Record<string, string>
  ) {}

  private abs(path: string): string {
    return resolve(this.cwd, path || '.')
  }

  async run(
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    /** Live output of run_command, for the agent's read-only terminal. */
    onOutput?: (chunk: string) => void
  ): Promise<ToolOutput> {
    try {
      switch (name) {
        case 'read_file':
          return await this.read(input)
        case 'write_file': {
          const file = this.abs(str(input, 'path'))
          await mkdir(dirname(file), { recursive: true })
          const content = str(input, 'content')
          await writeFile(file, content, 'utf8')
          return { content: `Wrote ${content.length} characters to ${this.display(file)}`, isError: false }
        }
        case 'edit_file':
          return await this.edit(input)
        case 'list_files':
          return await this.list(input)
        case 'run_command':
          return await this.exec(str(input, 'command'), Number(input['timeout_seconds']) || 120, signal, onOutput)
        default:
          return { content: `Unknown tool ${name}`, isError: true }
      }
    } catch (err) {
      return { content: (err as Error).message, isError: true }
    }
  }

  private display(file: string): string {
    const rel = relative(this.cwd, file)
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : file
  }

  private async read(input: Record<string, unknown>): Promise<ToolOutput> {
    const file = this.abs(str(input, 'path'))
    const info = await stat(file)
    if (info.isDirectory()) return { content: `${this.display(file)} is a folder; use list_files`, isError: true }
    if (info.size > MAX_READ_BYTES) {
      return { content: `${this.display(file)} is ${info.size} bytes; read it in parts with offset and limit`, isError: true }
    }
    const buffer = await readFile(file)
    if (buffer.includes(0)) return { content: `${this.display(file)} looks binary`, isError: true }
    const lines = buffer.toString('utf8').split('\n')
    const offset = Math.max(1, Number(input['offset']) || 1)
    const limit = Math.max(1, Number(input['limit']) || 2000)
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    const more = offset - 1 + limit < lines.length ? `\n[… ${lines.length - (offset - 1 + limit)} more lines]` : ''
    return { content: slice.join('\n') + more, isError: false }
  }

  private async edit(input: Record<string, unknown>): Promise<ToolOutput> {
    const file = this.abs(str(input, 'path'))
    const oldText = str(input, 'old_text')
    const newText = str(input, 'new_text')
    if (!oldText) return { content: 'old_text is empty', isError: true }
    const content = await readFile(file, 'utf8')
    const count = content.split(oldText).length - 1
    if (count === 0) return { content: `old_text was not found in ${this.display(file)}`, isError: true }
    if (count > 1 && input['replace_all'] !== true) {
      return { content: `old_text appears ${count} times; add context or set replace_all`, isError: true }
    }
    await writeFile(file, content.split(oldText).join(newText), 'utf8')
    return { content: `Replaced ${count} occurrence${count > 1 ? 's' : ''} in ${this.display(file)}`, isError: false }
  }

  private async list(input: Record<string, unknown>): Promise<ToolOutput> {
    const root = this.abs(str(input, 'path'))
    const depth = Math.min(5, Math.max(1, Number(input['depth']) || 2))
    const lines: string[] = []
    const walk = async (dir: string, level: number, prefix: string) => {
      if (lines.length >= MAX_LIST_ENTRIES) return
      const entries = (await readdir(dir, { withFileTypes: true })).sort(
        (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
      )
      for (const e of entries) {
        if (lines.length >= MAX_LIST_ENTRIES) {
          lines.push(`${prefix}…`)
          return
        }
        if (e.isDirectory()) {
          lines.push(`${prefix}${e.name}/`)
          if (level < depth && !SKIP_DIRS.has(e.name)) await walk(join(dir, e.name), level + 1, `${prefix}  `)
        } else lines.push(`${prefix}${e.name}`)
      }
    }
    await walk(root, 1, '')
    return { content: lines.length ? lines.join('\n') : '(empty folder)', isError: false }
  }

  private exec(
    command: string,
    timeoutSeconds: number,
    signal: AbortSignal,
    onOutput?: (chunk: string) => void
  ): Promise<ToolOutput> {
    const timeoutMs = Math.min(600, Math.max(1, timeoutSeconds)) * 1000
    return new Promise((resolvePromise) => {
      const child = spawn(this.shell.file, this.shell.args(command), {
        cwd: this.cwd,
        env: this.env,
        windowsHide: true,
        // A process group on POSIX lets a timeout or interrupt stop the whole command tree.
        detached: process.platform !== 'win32'
      })
      let output = ''
      const append = (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        onOutput?.(text)
        output += text
        if (output.length > MAX_OUTPUT_CHARS * 2) output = output.slice(-MAX_OUTPUT_CHARS)
      }
      child.stdout.on('data', append)
      child.stderr.on('data', append)
      let killedBy: 'timeout' | 'interrupt' | null = null
      const kill = (why: 'timeout' | 'interrupt') => {
        killedBy = why
        if (!child.pid) return
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        else {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {
            child.kill('SIGKILL')
          }
        }
      }
      const timer = setTimeout(() => kill('timeout'), timeoutMs)
      const onAbort = () => kill('interrupt')
      signal.addEventListener('abort', onAbort, { once: true })
      const finish = (content: string, isError: boolean) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolvePromise({ content: clip(content), isError })
      }
      child.on('error', (err) => finish(`Could not run the command: ${err.message}`, true))
      child.on('close', (code) => {
        const body = output.trimEnd() || '(no output)'
        if (killedBy === 'timeout') finish(`${body}\n[stopped after ${timeoutMs / 1000}s]`, true)
        else if (killedBy === 'interrupt') finish(`${body}\n[interrupted by the user]`, true)
        else finish(`${body}\n[exit code ${code ?? 'unknown'}]`, code !== 0)
      })
    })
  }
}
