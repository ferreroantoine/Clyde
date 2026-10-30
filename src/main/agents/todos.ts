import type { ProfileKind } from '@shared/profiles'
import type { TodoItem, TodoItemStatus } from '@shared/agent'

/** Clyde's own task-list tool: Clyde's loop gets it built in, Antigravity through the clyde MCP server. */
export const UPDATE_TODOS = 'update_todos'
/** The same tool, as the clyde MCP server's tool is named in a session. */
export const MCP_UPDATE_TODOS = `mcp__clyde__${UPDATE_TODOS}`

const MAX_ITEMS = 100
const MAX_TEXT = 500

function status(raw: unknown): TodoItemStatus | null {
  switch (raw) {
    case 'pending':
    case 'todo':
      return 'pending'
    case 'in_progress':
    case 'inProgress':
    case 'in-progress':
      return 'in_progress'
    case 'completed':
    case 'done':
      return 'completed'
    default:
      return null
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '')

/**
 * A list from TodoWrite (`content`, `activeForm`), update_todos (`text`, `id`, `active`) or
 * anything shaped like them. Entries without text or with an unknown status are dropped; null
 * when there is no list at all.
 */
export function parseTodoList(raw: unknown): TodoItem[] | null {
  if (!Array.isArray(raw)) return null
  const out: TodoItem[] = []
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const label = text(e['content'] ?? e['text'] ?? e['step'] ?? e['title'])
    const s = status(e['status'])
    if (!label || !s) continue
    const key = typeof e['id'] === 'string' || typeof e['id'] === 'number' ? String(e['id']).slice(0, 100) : ''
    const active = text(e['activeForm'] ?? e['active'])
    out.push({ ...(key ? { key } : {}), text: label, status: s, ...(active ? { active } : {}) })
  }
  return out
}

/** The task list a tool call carries: Claude Code's TodoWrite, or Clyde's update_todos. */
export function todosFromToolCall(name: string, input: Record<string, unknown>): TodoItem[] | null {
  if (name !== 'TodoWrite' && name !== UPDATE_TODOS && name !== MCP_UPDATE_TODOS) return null
  return parseTodoList(input['todos'])
}

/** Codex's plan (turn/plan/updated) as a task list. */
export function todosFromCodexPlan(plan: Array<{ step: string; status: string }>): TodoItem[] {
  return parseTodoList(plan.map((p) => ({ step: p.step, status: p.status }))) ?? []
}

/** The JSON schema of update_todos, shared by Clyde's loop and the clyde MCP server. */
export const UPDATE_TODOS_DESCRIPTION =
  'Write your task list for the current request. Send the whole list every time: each task with its status (pending, in_progress, completed). Keep exactly one task in_progress while you work. The user follows your progress in this list.'

export const UPDATE_TODOS_SCHEMA = {
  type: 'object',
  properties: {
    todos: {
      type: 'array',
      description: 'The whole list, in order.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A short stable id for the task, kept across updates.' },
          text: { type: 'string', description: 'The task, as an imperative sentence.' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          active: { type: 'string', description: 'For the task in progress: what you are doing now, e.g. "Running the tests".' }
        },
        required: ['text', 'status'],
        additionalProperties: false
      }
    }
  },
  required: ['todos'],
  additionalProperties: false
} as const

/**
 * The reflex every project session gets in its instructions: keep the task list, without
 * being asked. Names the tool the provider actually has.
 */
export function todoReflex(kind: ProfileKind): string {
  const tool =
    kind === 'claude-code'
      ? 'the TodoWrite tool'
      : kind === 'codex'
        ? 'your plan tool (update_plan)'
        : kind === 'antigravity'
          ? `the ${UPDATE_TODOS} tool of the clyde MCP server`
          : `the ${UPDATE_TODOS} tool`
  return [
    `Task list: for any request that takes more than one step, write your task list with ${tool} before you start.`,
    'Keep exactly one task in progress, mark each one completed as soon as it is done, and add the tasks you discover on the way.',
    'The user follows your work in this list, in Clyde’s Tasks view: keep it up to date without being asked.'
  ].join(' ')
}

/** What the agent reads back after updating its list. */
export function todosReceipt(items: readonly TodoItem[]): string {
  const done = items.filter((i) => i.status === 'completed').length
  const current = items.find((i) => i.status === 'in_progress')
  return `Task list updated: ${done}/${items.length} done${current ? `, in progress: ${current.text}` : ''}.`
}
