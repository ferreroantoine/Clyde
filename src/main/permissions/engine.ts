import { posix, win32 } from 'node:path'
import type { PermissionLevel } from '@shared/agent'

export type PermissionDecision =
  | { decision: 'allow' }
  | { decision: 'ask'; reason: string }
  | { decision: 'deny'; reason: string }

export interface ToolRequest {
  name: string
  input: Record<string, unknown>
}

export interface EngineContext {
  level: PermissionLevel
  /** The agent's working directory (its worktree from Phase 4 on). */
  cwd: string
  platform: NodeJS.Platform
}

/** Tools that only read, inspect or plan. Path-taking ones are still checked against the working directory. */
const READ_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'NotebookRead',
  'WebFetch',
  'WebSearch',
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'TaskOutput',
  'BashOutput',
  'KillShell',
  'TaskStop',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'EnterPlanMode',
  // Subagents and skills run their own tool calls, which come through this engine too.
  'Agent',
  'Task',
  'Skill'
])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const EXEC_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor'])

function pathOf(input: Record<string, unknown>): string | null {
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix
}

/** True when `target` (absolute, or relative to cwd) stays inside cwd. */
export function isInsideDir(cwd: string, target: string, platform: NodeJS.Platform): boolean {
  const p = pathApi(platform)
  if (target.startsWith('~')) return false
  const fold = (s: string) => (platform === 'win32' ? s.toLowerCase() : s)
  const rel = p.relative(fold(p.resolve(cwd)), fold(p.resolve(cwd, target)))
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel))
}

const GIT_PUSH = /\bgit\b[^;&|\n]*\spush\b/i
const CHANGE_DIR = /(?:^|[;&|\n(]\s*)(?:cd|pushd|chdir|Set-Location|sl)\s+(?:-LiteralPath\s+|-Path\s+)?("[^"]*"|'[^']*'|[^\s;&|)]+)/gi

/** Directories a shell command switches to with cd/pushd/Set-Location. Best effort, not a sandbox. */
export function changedDirs(command: string): string[] {
  const out: string[] = []
  for (const match of command.matchAll(CHANGE_DIR)) {
    const raw = match[1] ?? ''
    out.push(raw.replace(/^["']|["']$/g, ''))
  }
  return out
}

/**
 * Decides one tool call for an agent. Pure, so every rule is unit-tested.
 * `ask` goes to the approval broker; the user's answer becomes the final allow or deny.
 */
export function decide(ctx: EngineContext, tool: ToolRequest): PermissionDecision {
  const { level, cwd, platform } = ctx
  const target = pathOf(tool.input)
  const pattern = typeof tool.input['pattern'] === 'string' ? (tool.input['pattern'] as string) : null
  const outside = (p: string | null) => p !== null && !isInsideDir(cwd, p, platform)

  if (READ_TOOLS.has(tool.name)) {
    const globOutside = tool.name === 'Glob' && pattern !== null && pathApi(platform).isAbsolute(pattern) && outside(pattern)
    if (outside(target) || globOutside) {
      const where = globOutside ? pattern : target
      return level === 'autonomous'
        ? { decision: 'deny', reason: `${where} is outside the agent's folder` }
        : { decision: 'ask', reason: `Reads outside the agent's folder: ${where}` }
    }
    return { decision: 'allow' }
  }

  if (WRITE_TOOLS.has(tool.name)) {
    if (outside(target)) {
      return level === 'autonomous'
        ? { decision: 'deny', reason: `${target} is outside the agent's folder` }
        : { decision: 'ask', reason: `Writes outside the agent's folder: ${target}` }
    }
    if (level === 'validate-all') return { decision: 'ask', reason: 'File changes need your approval' }
    return { decision: 'allow' }
  }

  if (EXEC_TOOLS.has(tool.name)) {
    const command = typeof tool.input['command'] === 'string' ? (tool.input['command'] as string) : ''
    if (level !== 'autonomous') return { decision: 'ask', reason: 'Shell commands need your approval' }
    if (GIT_PUSH.test(command)) return { decision: 'deny', reason: 'git push is not allowed for autonomous agents' }
    const escape = changedDirs(command).find((dir) => !isInsideDir(cwd, dir, platform))
    if (escape) return { decision: 'deny', reason: `The command leaves the agent's folder (${escape})` }
    return { decision: 'allow' }
  }

  if (tool.name.startsWith('mcp__')) {
    return level === 'autonomous' ? { decision: 'allow' } : { decision: 'ask', reason: 'MCP tools need your approval' }
  }

  return { decision: 'ask', reason: `${tool.name} is not a tool Clyde knows, so it needs your approval` }
}
