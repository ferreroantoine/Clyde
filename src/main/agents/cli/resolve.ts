import { t } from '@shared/i18n'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { AppError } from '@shared/errors'

/** File system access the resolver needs, swappable in tests. */
export interface ResolveFs {
  exists(path: string): boolean
  realpath(path: string): string
}

const realFs: ResolveFs = {
  exists: existsSync,
  realpath: (p) => {
    try {
      return realpathSync(p)
    } catch {
      return p
    }
  }
}

export interface ResolveContext {
  platform: NodeJS.Platform
  arch: string
  env: NodeJS.ProcessEnv
  home: string
  fs: ResolveFs
}

export function defaultContext(): ResolveContext {
  return { platform: process.platform, arch: process.arch, env: process.env, home: homedir(), fs: realFs }
}

const pathOf = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix)

function pathEntries(ctx: ResolveContext): string[] {
  // Windows keeps the variable as `Path`; lookups on process.env are case-insensitive there but not on copies.
  const key = Object.keys(ctx.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const raw = ctx.env[key] ?? ''
  return raw.split(ctx.platform === 'win32' ? ';' : ':').filter(Boolean)
}

/** Every file named like one of `names` on PATH, then in `extraDirs`, in order. */
export function findOnPath(names: string[], ctx: ResolveContext, extraDirs: string[] = []): string[] {
  const p = pathOf(ctx.platform)
  const out: string[] = []
  for (const dir of [...pathEntries(ctx), ...extraDirs]) {
    for (const name of names) {
      const file = p.join(dir.replace(/^"|"$/g, ''), name)
      if (ctx.fs.exists(file) && !out.includes(file)) out.push(file)
    }
  }
  return out
}

const CODEX_TRIPLES: Record<string, string> = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl'
}

/**
 * The native binary inside an npm install of `@openai/codex`, given the package folder.
 * npm's own launcher (`bin/codex.js`) does the same lookup; running the binary directly
 * avoids a Node wrapper (and, on Windows, a .cmd shim) between Clyde and Codex.
 */
export function codexNativeBinary(packageDir: string, ctx: ResolveContext): string | null {
  const triple = CODEX_TRIPLES[`${ctx.platform}-${ctx.arch}`]
  if (!triple) return null
  const p = pathOf(ctx.platform)
  const exe = ctx.platform === 'win32' ? 'codex.exe' : 'codex'
  const platformPkg = `codex-${ctx.platform}-${ctx.arch}`
  const candidates = [
    // Nested (npm install -g) and hoisted (local install) layouts.
    p.join(packageDir, 'node_modules', '@openai', platformPkg, 'vendor', triple, 'bin', exe),
    p.join(packageDir, '..', platformPkg, 'vendor', triple, 'bin', exe),
    p.join(packageDir, 'vendor', triple, 'bin', exe)
  ]
  return candidates.find((c) => ctx.fs.exists(c)) ?? null
}

/** From a launcher on PATH (codex.cmd, or a symlink to bin/codex.js), the npm package folder. */
function codexPackageOf(launcher: string, ctx: ResolveContext): string | null {
  const p = pathOf(ctx.platform)
  const real = ctx.fs.realpath(launcher)
  if (/[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js$/i.test(real)) return p.dirname(p.dirname(real))
  const nextToShim = p.join(p.dirname(launcher), 'node_modules', '@openai', 'codex')
  return ctx.fs.exists(nextToShim) ? nextToShim : null
}

/**
 * The Codex executable: the user's override when set, else the one on PATH. npm shims are
 * resolved to the native binary they wrap.
 */
export function resolveCodexBinary(override: string, ctx: ResolveContext = defaultContext()): string {
  const fromShim = (file: string): string | null => {
    if (/\.exe$/i.test(file) || (ctx.platform !== 'win32' && !ctx.fs.realpath(file).endsWith('.js'))) return file
    const pkg = codexPackageOf(file, ctx)
    return pkg ? codexNativeBinary(pkg, ctx) : null
  }
  if (override.trim()) {
    if (!ctx.fs.exists(override)) throw new AppError('cli_missing', t('Codex was not found at {override}', { override }))
    const native = fromShim(override)
    if (!native) throw new AppError('cli_missing', t('{override} is not a Codex executable Clyde can start. Point to codex.exe.', { override }))
    return native
  }
  const names = ctx.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']
  for (const file of findOnPath(names, ctx)) {
    const native = fromShim(file)
    if (native) return native
  }
  throw new AppError(
    'cli_missing',
    t('Codex CLI was not found. Install it (npm install -g @openai/codex), or set its path in Settings.')
  )
}

/**
 * The Antigravity CLI: the override, else `agy` on PATH, else where its installer puts it
 * (~/.local/bin).
 */
export function resolveAntigravityBinary(override: string, ctx: ResolveContext = defaultContext()): string {
  if (override.trim()) {
    if (!ctx.fs.exists(override)) throw new AppError('cli_missing', t('Antigravity CLI was not found at {override}', { override }))
    return override
  }
  const names = ctx.platform === 'win32' ? ['agy.exe'] : ['agy']
  const local = pathOf(ctx.platform).join(ctx.home, '.local', 'bin')
  const [found] = findOnPath(names, ctx, [local])
  if (found) return found
  throw new AppError(
    'cli_missing',
    t('Antigravity CLI (agy) was not found. Install it from antigravity.google, or set its path in Settings.')
  )
}
