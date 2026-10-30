import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRIDGE_JSON, BRIDGE_PREVIOUS, bridgeCommand, installBridge, readBridge } from './claude-bridge'

const dir = () => mkdtempSync(join(tmpdir(), 'claude-profile-'))
const settingsOf = (d: string) => JSON.parse(readFileSync(join(d, 'settings.json'), 'utf8'))

describe('Claude status line bridge', () => {
  it('installs itself in an empty profile', () => {
    const d = dir()
    expect(installBridge(d, 'linux')).toBe(true)
    expect(settingsOf(d).statusLine).toEqual({ type: 'command', command: bridgeCommand(d, 'linux') })
    expect(existsSync(join(d, 'clyde-statusline.sh'))).toBe(true)
  })

  it('chains an existing status line instead of replacing it, and stays idempotent', () => {
    const d = dir()
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: 'echo mine', padding: 1 } }))
    installBridge(d, 'linux')
    installBridge(d, 'linux')
    expect(readFileSync(join(d, BRIDGE_PREVIOUS), 'utf8')).toBe('echo mine')
    expect(settingsOf(d)).toEqual({ model: 'opus', statusLine: { type: 'command', command: bridgeCommand(d, 'linux'), padding: 1 } })
  })

  it('never overwrites a settings file it cannot read', () => {
    const d = dir()
    writeFileSync(join(d, 'settings.json'), '{ broken')
    expect(installBridge(d, 'linux')).toBe(false)
    expect(readFileSync(join(d, 'settings.json'), 'utf8')).toBe('{ broken')
  })

  it('writes Windows commands with forward slashes and a PowerShell script', () => {
    expect(bridgeCommand('C:\\Users\\Jo Do\\AppData\\Roaming\\Clyde\\claude-profiles\\p1', 'win32')).toBe(
      'powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Users/Jo Do/AppData/Roaming/Clyde/claude-profiles/p1/clyde-statusline.ps1"'
    )
  })

  it('saves the input with limits and passes it on to the previous status line (real sh)', () => {
    const d = dir()
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'cat' } }))
    installBridge(d, 'linux')
    const input = JSON.stringify({ model: { id: 'x' }, rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 } } })
    const output = execFileSync('sh', [join(d, 'clyde-statusline.sh')], { input, env: { ...process.env, SHELL: '/bin/sh' } }).toString()
    expect(output).toBe(input)
    expect(readBridge(d)).toEqual([
      { window: 'five_hour', label: '5-hour window', usedPct: 23.5, resetsAt: 1738425600000, source: 'claude-statusline' }
    ])
    // Input without limits (before the first answer) leaves the saved file alone.
    execFileSync('sh', [join(d, 'clyde-statusline.sh')], { input: '{"model":{}}' })
    expect(readBridge(d)).toHaveLength(1)
    expect(existsSync(join(d, `${BRIDGE_JSON}.tmp`))).toBe(false)
  })
})
