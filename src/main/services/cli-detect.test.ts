import { describe, expect, it, vi } from 'vitest'
import { parseVersion } from '@shared/cli'
import { CliDetectService } from './cli-detect'

describe('CliDetectService', () => {
  it('reports path and version of each CLI, and why one is missing', async () => {
    const version = vi.fn(async (kind: string) => (kind === 'claude-code' ? '2.1.312 (Claude Code)\n' : 'codex-cli 0.165.0\n'))
    let now = 0
    const service = new CliDetectService({
      paths: () => ({ 'claude-code': '', codex: '', antigravity: '' }),
      version,
      now: () => now,
      resolve: {
        'claude-code': () => '/sdk/claude',
        codex: () => '/bin/codex',
        antigravity: () => {
          throw new Error('Antigravity CLI (agy) was not found.')
        }
      }
    })
    expect(await service.status()).toEqual([
      { kind: 'claude-code', installed: true, path: '/sdk/claude', version: '2.1.312', bundled: true, detail: null },
      { kind: 'codex', installed: true, path: '/bin/codex', version: '0.165.0', bundled: false, detail: null },
      { kind: 'antigravity', installed: false, path: null, version: null, bundled: false, detail: 'Antigravity CLI (agy) was not found.' }
    ])
    expect(service.versionOf('codex')).toBe('0.165.0')
    await service.status()
    expect(version).toHaveBeenCalledTimes(2)
    now = 61_000
    await service.status()
    expect(version).toHaveBeenCalledTimes(4)
  })

  it('finds versions in the usual outputs', () => {
    expect(parseVersion('agy version 1.4.7 (abc123)')).toBe('1.4.7')
    expect(parseVersion('v2.0.0-beta.3')).toBe('2.0.0-beta.3')
    expect(parseVersion('no version')).toBeNull()
  })
})
