import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { basename } from 'node:path'
import * as nodePty from 'node-pty'
import { AppError } from '@shared/errors'
import type { PtyInfo } from '@shared/types'
import { createLogger } from '../logger'

const log = createLogger('pty')
const FLUSH_MS = 8

export interface PtyEvents {
  onData: (id: string, data: string) => void
  onExit: (id: string, exitCode: number) => void
}

let detectedShell: string | null = null

/** pwsh when installed, otherwise Windows PowerShell; $SHELL elsewhere. */
export function defaultShell(): string {
  if (detectedShell) return detectedShell
  if (process.platform !== 'win32') return (detectedShell = process.env['SHELL'] || '/bin/bash')
  try {
    const found = execFileSync('where.exe', ['pwsh.exe'], { encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/)
      .find((line) => line.trim())
    if (found && existsSync(found.trim())) return (detectedShell = found.trim())
  } catch {
    // not installed
  }
  return (detectedShell = 'powershell.exe')
}

/** True on Windows when PowerShell 7 (pwsh) is installed. */
export function hasPwsh(): boolean {
  return process.platform === 'win32' && /pwsh(\.exe)?$/i.test(defaultShell())
}

export function windowsBuild(): number | null {
  if (process.platform !== 'win32') return null
  const build = Number(release().split('.')[2])
  return Number.isFinite(build) ? build : null
}

/** A program to run instead of the user's shell, e.g. Claude Code's login for one profile. */
export interface PtyCommand {
  file: string
  args: string[]
  /** Replaces the inherited environment entirely. */
  env: Record<string, string>
  title: string
}

interface Session {
  pty: nodePty.IPty
  buffer: string
  timer: NodeJS.Timeout | null
}

/** Owns the shell processes behind the integrated terminals. Output is coalesced to limit IPC traffic. */
export class PtyService {
  private readonly sessions = new Map<string, Session>()
  private nextId = 1

  constructor(
    private readonly events: PtyEvents,
    private readonly shellSetting: () => string
  ) {}

  create(opts: { cwd: string | undefined; cols: number; rows: number; command?: PtyCommand }): PtyInfo {
    const shell = opts.command?.file ?? (this.shellSetting().trim() || defaultShell())
    const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : homedir()
    const id = `pty-${this.nextId++}`
    const env = opts.command?.env ?? (process.env as Record<string, string>)
    let pty: nodePty.IPty
    try {
      pty = nodePty.spawn(shell, opts.command?.args ?? [], {
        name: 'xterm-256color',
        cols: opts.cols,
        rows: opts.rows,
        cwd,
        env: { ...env, TERM_PROGRAM: 'Atelier' }
      })
    } catch (err) {
      throw new AppError('pty_error', `Could not start ${shell}: ${(err as Error).message}`)
    }
    const session: Session = { pty, buffer: '', timer: null }
    this.sessions.set(id, session)

    pty.onData((data) => {
      session.buffer += data
      session.timer ??= setTimeout(() => this.flush(id), FLUSH_MS)
    })
    pty.onExit(({ exitCode }) => {
      this.flush(id)
      this.sessions.delete(id)
      this.events.onExit(id, exitCode)
    })
    log.info(`started ${id}: ${opts.command?.title ?? shell} in ${cwd}`)
    const title = opts.command?.title ?? basename(shell).replace(/\.exe$/i, '')
    return { id, shell, cwd, title, windowsBuild: windowsBuild() }
  }

  private flush(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.timer = null
    if (!session.buffer) return
    const data = session.buffer
    session.buffer = ''
    this.events.onData(id, data)
  }

  private get(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new AppError('not_found', `Terminal ${id} is not running`)
    return session
  }

  write(id: string, data: string): void {
    this.get(id).pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.get(id).pty.resize(cols, rows)
    } catch (err) {
      if (err instanceof AppError) throw err
      // Resizing a process that is exiting can throw; it is harmless.
    }
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.timer) clearTimeout(session.timer)
    session.pty.kill()
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
