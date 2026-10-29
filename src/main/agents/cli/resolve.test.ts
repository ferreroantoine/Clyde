import { describe, expect, it } from 'vitest'
import { codexNativeBinary, findOnPath, resolveAntigravityBinary, resolveCodexBinary, type ResolveContext } from './resolve'

/** A fake file system: `files` exist, `links` map a path to its real path. */
function ctx(platform: NodeJS.Platform, files: string[], env: NodeJS.ProcessEnv, links: Record<string, string> = {}): ResolveContext {
  const set = new Set(files)
  return {
    platform,
    arch: 'x64',
    env,
    home: platform === 'win32' ? 'C:\\Users\\me' : '/home/me',
    fs: { exists: (p) => set.has(p), realpath: (p) => links[p] ?? p }
  }
}

const NPM = 'C:\\Users\\me\\AppData\\Roaming\\npm'
const WIN_NATIVE = `${NPM}\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`

describe('CLI resolution', () => {
  it('reads PATH whatever its case on Windows, and strips quotes', () => {
    const c = ctx('win32', ['C:\\Tools\\agy.exe'], { Path: 'C:\\Windows;"C:\\Tools"' })
    expect(findOnPath(['agy.exe'], c)).toEqual(['C:\\Tools\\agy.exe'])
  })

  it('turns the npm codex.cmd shim into the native codex.exe it wraps', () => {
    const c = ctx('win32', [`${NPM}\\codex.cmd`, `${NPM}\\node_modules\\@openai\\codex`, WIN_NATIVE], { Path: `C:\\Windows;${NPM}` })
    expect(resolveCodexBinary('', c)).toBe(WIN_NATIVE)
    // An override pointing at the shim works too.
    expect(resolveCodexBinary(`${NPM}\\codex.cmd`, c)).toBe(WIN_NATIVE)
  })

  it('prefers a codex.exe on PATH', () => {
    const c = ctx('win32', ['C:\\bin\\codex.exe', `${NPM}\\codex.cmd`], { Path: `C:\\bin;${NPM}` })
    expect(resolveCodexBinary('', c)).toBe('C:\\bin\\codex.exe')
  })

  it('follows the npm symlink to the hoisted native binary on Linux', () => {
    const js = '/usr/lib/node_modules/@openai/codex/bin/codex.js'
    const native = '/usr/lib/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex'
    const c = ctx('linux', ['/usr/bin/codex', native], { PATH: '/usr/bin' }, { '/usr/bin/codex': js })
    expect(resolveCodexBinary('', c)).toBe(native)
    expect(codexNativeBinary('/usr/lib/node_modules/@openai/codex', c)).toBe(native)
  })

  it('explains how to install a missing CLI, and rejects a wrong override', () => {
    const c = ctx('win32', [], { Path: 'C:\\Windows' })
    expect(() => resolveCodexBinary('', c)).toThrow(/npm install -g @openai\/codex/)
    expect(() => resolveCodexBinary('C:\\nope\\codex.exe', c)).toThrow(/not found at/)
    expect(() => resolveAntigravityBinary('', c)).toThrow(/antigravity\.google/)
  })

  it('finds agy where its installer puts it when it is not on PATH', () => {
    const c = ctx('win32', ['C:\\Users\\me\\.local\\bin\\agy.exe'], { Path: 'C:\\Windows' })
    expect(resolveAntigravityBinary('', c)).toBe('C:\\Users\\me\\.local\\bin\\agy.exe')
  })
})
