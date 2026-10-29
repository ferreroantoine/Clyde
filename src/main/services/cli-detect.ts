import { execFile } from 'node:child_process'
import { parseVersion, type CliStatus } from '@shared/cli'
import type { CliProfileKind } from '@shared/profiles'
import { resolveClaudeBinary, withoutAccountVars } from '../agents/claude-code/runtime'
import { resolveAntigravityBinary, resolveCodexBinary } from '../agents/cli/resolve'
import { runAgy } from '../agents/antigravity/runtime'
import { spawnPty } from '../agents/cli/pty-process'

const CACHE_MS = 60_000

export interface CliDetectDeps {
  paths: () => Record<CliProfileKind, string>
  /** Runs `<binary> --version`; agy goes through a pty, since it may print nothing otherwise. */
  version?: (kind: CliProfileKind, binary: string) => Promise<string>
  resolve?: Partial<Record<CliProfileKind, (override: string) => string>>
  now?: () => number
}

function execVersion(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, ['--version'], { env: withoutAccountVars(process.env), timeout: 15_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stdout) reject(err)
      else resolve(`${stdout}\n${stderr}`)
    })
  })
}

const defaultVersion = async (kind: CliProfileKind, binary: string): Promise<string> => {
  if (kind !== 'antigravity') return execVersion(binary)
  const { output } = await runAgy(spawnPty, { binary, env: withoutAccountVars(process.env), cwd: process.cwd() }, ['--version'], 15_000)
  return output
}

const KINDS: CliProfileKind[] = ['claude-code', 'codex', 'antigravity']

/** Finds each coding CLI and asks its version. Cached for a minute; `refresh` asks again. */
export class CliDetectService {
  private cache: { at: number; result: Promise<CliStatus[]> } | null = null
  private last: CliStatus[] = []

  constructor(private readonly deps: CliDetectDeps) {}

  status(refresh = false): Promise<CliStatus[]> {
    const now = this.deps.now?.() ?? Date.now()
    if (!refresh && this.cache && now - this.cache.at < CACHE_MS) return this.cache.result
    const result = Promise.all(KINDS.map((k) => this.detect(k))).then((list) => (this.last = list))
    this.cache = { at: now, result }
    return result
  }

  /** The version found by the latest detection, without waiting for a new one. */
  versionOf(kind: CliProfileKind): string {
    return this.last.find((s) => s.kind === kind)?.version ?? ''
  }

  private async detect(kind: CliProfileKind): Promise<CliStatus> {
    const override = this.deps.paths()[kind]
    const resolve =
      this.deps.resolve?.[kind] ??
      { 'claude-code': resolveClaudeBinary, codex: (o: string) => resolveCodexBinary(o), antigravity: (o: string) => resolveAntigravityBinary(o) }[kind]
    let path: string
    try {
      path = resolve(override)
    } catch (err) {
      return { kind, installed: false, path: null, version: null, bundled: false, detail: (err as Error).message }
    }
    const bundled = kind === 'claude-code' && !override.trim()
    try {
      const output = await (this.deps.version ?? defaultVersion)(kind, path)
      return { kind, installed: true, path, version: parseVersion(output), bundled, detail: null }
    } catch (err) {
      return { kind, installed: true, path, version: null, bundled, detail: `It did not report its version: ${(err as Error).message}` }
    }
  }
}
