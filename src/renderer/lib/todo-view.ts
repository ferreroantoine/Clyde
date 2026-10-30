import type { Todo, TodoStatus } from '@shared/todos'
import type { TodoItem } from '@shared/agent'

export type TodoFilter = { kind: 'all' } | { kind: 'mine' } | { kind: 'session'; sessionId: string }

/** Done tasks older than this fold under one line. */
export const OLD_DONE_MS = 7 * 24 * 60 * 60 * 1000

export interface Columns {
  todo: Todo[]
  in_progress: Todo[]
  done: Todo[]
  /** Done more than a week ago: folded at the bottom of Done. */
  olderDone: Todo[]
}

export function matches(todo: Todo, filter: TodoFilter): boolean {
  if (filter.kind === 'mine') return todo.sessionId === null
  if (filter.kind === 'session') return todo.sessionId === filter.sessionId
  return true
}

/** The tasks in their columns, in board order; done ones newest first. */
export function columnsOf(todos: readonly Todo[], filter: TodoFilter, now: number): Columns {
  const out: Columns = { todo: [], in_progress: [], done: [], olderDone: [] }
  const shown = todos.filter((x) => matches(x, filter))
  const order = (a: Todo, b: Todo) => a.position - b.position || a.createdAt - b.createdAt
  for (const status of ['todo', 'in_progress'] as const satisfies readonly TodoStatus[]) {
    out[status] = shown.filter((x) => x.status === status).sort(order)
  }
  const done = shown.filter((x) => x.status === 'done').sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt))
  out.done = done.filter((x) => now - (x.doneAt ?? x.updatedAt) <= OLD_DONE_MS)
  out.olderDone = done.filter((x) => now - (x.doneAt ?? x.updatedAt) > OLD_DONE_MS)
  return out
}

/** "3/7" and the task in progress, for a session's header. */
export function progressOf(items: readonly TodoItem[] | null): { done: number; total: number; current: TodoItem | null } | null {
  if (!items?.length) return null
  return {
    done: items.filter((i) => i.status === 'completed').length,
    total: items.length,
    current: items.find((i) => i.status === 'in_progress') ?? null
  }
}
