import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { redact } from '@shared/redact'

type Level = 'debug' | 'info' | 'warn' | 'error'

let logFile: string | null = null

function file(): string | null {
  if (logFile) return logFile
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'main.log')
  } catch {
    logFile = null
  }
  return logFile
}

function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function write(level: Level, scope: string, parts: unknown[]): void {
  const line = redact(`${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${parts.map(format).join(' ')}`)
  const out = level === 'error' || level === 'warn' ? console.error : console.log
  out(line)
  const target = file()
  if (target) {
    try {
      appendFileSync(target, line + '\n')
    } catch {
      // Logging must never crash the app.
    }
  }
}

export function createLogger(scope: string) {
  return {
    debug: (...parts: unknown[]) => write('debug', scope, parts),
    info: (...parts: unknown[]) => write('info', scope, parts),
    warn: (...parts: unknown[]) => write('warn', scope, parts),
    error: (...parts: unknown[]) => write('error', scope, parts)
  }
}

export type Logger = ReturnType<typeof createLogger>
