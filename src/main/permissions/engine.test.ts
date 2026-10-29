import { describe, expect, it } from 'vitest'
import type { PermissionLevel } from '@shared/agent'
import { changedDirs, decide, isInsideDir } from './engine'

const posixCtx = (level: PermissionLevel) => ({ level, cwd: '/home/me/repo', platform: 'linux' as const })
const winCtx = (level: PermissionLevel) => ({ level, cwd: 'C:\\Users\\me\\repo', platform: 'win32' as const })
const LEVELS: PermissionLevel[] = ['validate-all', 'files-auto', 'autonomous']

describe('isInsideDir', () => {
  it('handles relative, absolute and escaping paths', () => {
    expect(isInsideDir('/home/me/repo', 'src/a.ts', 'linux')).toBe(true)
    expect(isInsideDir('/home/me/repo', '/home/me/repo/src/a.ts', 'linux')).toBe(true)
    expect(isInsideDir('/home/me/repo', '/home/me/repo', 'linux')).toBe(true)
    expect(isInsideDir('/home/me/repo', '../other/a.ts', 'linux')).toBe(false)
    expect(isInsideDir('/home/me/repo', '/home/me/repo-evil/a.ts', 'linux')).toBe(false)
    expect(isInsideDir('/home/me/repo', '~/.ssh/id_rsa', 'linux')).toBe(false)
  })

  it('is case-insensitive and drive-aware on Windows', () => {
    expect(isInsideDir('C:\\Users\\me\\repo', 'c:\\users\\ME\\Repo\\src\\a.ts', 'win32')).toBe(true)
    expect(isInsideDir('C:\\Users\\me\\repo', 'D:\\repo\\a.ts', 'win32')).toBe(false)
    expect(isInsideDir('C:\\Users\\me\\repo', 'src/a.ts', 'win32')).toBe(true)
  })
})

describe('decide', () => {
  it('allows reads inside the folder at every level', () => {
    for (const level of LEVELS) {
      expect(decide(posixCtx(level), { name: 'Read', input: { file_path: '/home/me/repo/a.ts' } }).decision).toBe('allow')
      expect(decide(posixCtx(level), { name: 'Grep', input: { pattern: 'x' } }).decision).toBe('allow')
      expect(decide(posixCtx(level), { name: 'Agent', input: { prompt: 'look around' } }).decision).toBe('allow')
    }
  })

  it('asks for reads outside the folder, and denies them when autonomous', () => {
    const outside = { name: 'Read', input: { file_path: '/etc/passwd' } }
    expect(decide(posixCtx('validate-all'), outside).decision).toBe('ask')
    expect(decide(posixCtx('files-auto'), outside).decision).toBe('ask')
    expect(decide(posixCtx('autonomous'), outside).decision).toBe('deny')
    expect(decide(posixCtx('autonomous'), { name: 'Glob', input: { pattern: '/etc/**' } }).decision).toBe('deny')
  })

  it('applies each level to file writes', () => {
    const write = { name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } }
    expect(decide(posixCtx('validate-all'), write).decision).toBe('ask')
    expect(decide(posixCtx('files-auto'), write).decision).toBe('allow')
    expect(decide(posixCtx('autonomous'), write).decision).toBe('allow')

    const outside = { name: 'Write', input: { file_path: '/home/me/.bashrc', content: '' } }
    expect(decide(posixCtx('validate-all'), outside).decision).toBe('ask')
    expect(decide(posixCtx('files-auto'), outside).decision).toBe('ask')
    expect(decide(posixCtx('autonomous'), outside)).toMatchObject({ decision: 'deny' })

    const notebook = { name: 'NotebookEdit', input: { notebook_path: 'C:\\temp\\n.ipynb' } }
    expect(decide(winCtx('autonomous'), notebook).decision).toBe('deny')
  })

  it('applies each level to shell commands', () => {
    const cmd = { name: 'Bash', input: { command: 'npm test' } }
    expect(decide(posixCtx('validate-all'), cmd).decision).toBe('ask')
    expect(decide(posixCtx('files-auto'), cmd).decision).toBe('ask')
    expect(decide(posixCtx('autonomous'), cmd).decision).toBe('allow')
    expect(decide(winCtx('files-auto'), { name: 'PowerShell', input: { command: 'Get-ChildItem' } }).decision).toBe('ask')
  })

  it('refuses git push and leaving the folder when autonomous', () => {
    const run = (command: string) => decide(posixCtx('autonomous'), { name: 'Bash', input: { command } }).decision
    expect(run('git push origin main')).toBe('deny')
    expect(run('git -C . push')).toBe('deny')
    expect(run('npm test && git push --force')).toBe('deny')
    expect(run('cd .. && ls')).toBe('deny')
    expect(run('cd /tmp; rm -rf x')).toBe('deny')
    expect(run('cd src && ls')).toBe('allow')
    expect(run('git status && git log --oneline')).toBe('allow')
    expect(run('echo pushing')).toBe('allow')
    const ps = (command: string) => decide(winCtx('autonomous'), { name: 'PowerShell', input: { command } }).decision
    expect(ps('Set-Location -LiteralPath "C:\\Windows"; dir')).toBe('deny')
    expect(ps('Set-Location src; dir')).toBe('allow')
  })

  it('asks for MCP and unknown tools unless autonomous allows MCP', () => {
    expect(decide(posixCtx('files-auto'), { name: 'mcp__github__create_issue', input: {} }).decision).toBe('ask')
    expect(decide(posixCtx('autonomous'), { name: 'mcp__github__create_issue', input: {} }).decision).toBe('allow')
    for (const level of LEVELS) {
      expect(decide(posixCtx(level), { name: 'ExitPlanMode', input: {} }).decision).toBe('ask')
      expect(decide(posixCtx(level), { name: 'SomethingNew', input: {} }).decision).toBe('ask')
    }
  })
})

describe('changedDirs', () => {
  it('finds cd targets in chained commands', () => {
    expect(changedDirs('cd "my dir" && ls; pushd /tmp')).toEqual(['my dir', '/tmp'])
    expect(changedDirs('echo cd nothing')).toEqual([])
  })
})
