import { randomUUID } from 'node:crypto'
import { t } from '@shared/i18n'
import type { AgentEventEnvelope, TodoItem, TodoItemStatus } from '@shared/agent'
import { AppError } from '@shared/errors'
import { todoCreateSchema, todoUpdateSchema, type Todo, type TodoCreate, type TodoStatus, type TodoUpdate } from '@shared/todos'
import type { Db } from '../services/db/database'

export interface TodoRow {
  id: string
  root: string
  text: string
  status: TodoStatus
  session_id: string | null
  origin: 'user' | 'agent'
  item_key: string | null
  active: string | null
  position: number
  created_at: number
  updated_at: number
  done_at: number | null
}

const toTodo = (r: TodoRow): Todo => ({
  id: r.id,
  text: r.text,
  status: r.status,
  sessionId: r.session_id,
  origin: r.origin,
  active: r.active,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  doneAt: r.done_at
})

const COLUMN: Record<TodoItemStatus, TodoStatus> = { pending: 'todo', in_progress: 'in_progress', completed: 'done' }

/** Same task whatever the case, spacing or final period. */
export const sameText = (a: string, b: string) => norm(a) === norm(b)
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '').toLowerCase()

export interface Reconciled {
  insert: Array<Pick<TodoRow, 'text' | 'status' | 'item_key' | 'active' | 'position' | 'done_at'>>
  update: Array<{ id: string; patch: Partial<Pick<TodoRow, 'text' | 'status' | 'item_key' | 'active' | 'position' | 'done_at'>> }>
  remove: string[]
  /** User tasks without a session that the list took over (same text): they join the session. */
  adopt: string[]
}

/**
 * What an agent's new list changes in its session's tasks. Items find their task by key, else
 * by text; new ones are added. A task the list no longer has goes, unless it is done (the
 * history stays) or the user wrote it (it was handed to the agent and stays on the board).
 * `base` orders the session's tasks after the ones already there. `adoptable` are the user's
 * unassigned tasks: one the agent writes too (a task handed over through the message box) is
 * taken over rather than doubled.
 */
export function reconcile(existing: readonly TodoRow[], items: readonly TodoItem[], base: number, now: number, adoptable: readonly TodoRow[] = []): Reconciled {
  const out: Reconciled = { insert: [], update: [], remove: [], adopt: [] }
  const free = new Set([...existing, ...adoptable].map((r) => r.id))
  const take = (row: TodoRow | undefined) => {
    if (!row || !free.has(row.id)) return undefined
    free.delete(row.id)
    return row
  }
  items.forEach((item, index) => {
    const byKey = item.key ? take(existing.find((r) => free.has(r.id) && r.item_key === item.key)) : undefined
    const own = byKey ?? take(existing.find((r) => free.has(r.id) && sameText(r.text, item.text)))
    const adopted = own ? undefined : take(adoptable.find((r) => free.has(r.id) && sameText(r.text, item.text)))
    if (adopted) out.adopt.push(adopted.id)
    const row = own ?? adopted
    const status = COLUMN[item.status]
    const position = base + index / 1000
    const active = item.status === 'in_progress' ? (item.active ?? null) : null
    if (!row) {
      out.insert.push({ text: item.text, status, item_key: item.key ?? null, active, position, done_at: status === 'done' ? now : null })
      return
    }
    const patch: Reconciled['update'][number]['patch'] = {}
    if (row.text !== item.text) patch.text = item.text
    if (row.status !== status) {
      patch.status = status
      patch.done_at = status === 'done' ? now : null
    }
    if ((item.key ?? null) !== row.item_key && item.key) patch.item_key = item.key
    if (row.active !== active) patch.active = active
    if (row.position !== position) patch.position = position
    if (Object.keys(patch).length) out.update.push({ id: row.id, patch })
  })
  for (const row of existing) {
    if (!free.has(row.id)) continue
    if (row.status === 'done' || row.origin === 'user') {
      // Kept, but no longer "in progress" for an agent that dropped it.
      if (row.active !== null) out.update.push({ id: row.id, patch: { active: null } })
      continue
    }
    out.remove.push(row.id)
  }
  return out
}

/**
 * The Tasks view's list, per project folder: the user's tasks and the lists agents keep
 * (TodoWrite, Codex's plan, update_todos), one task per row.
 */
export class TodoService {
  constructor(
    private readonly db: Db,
    private readonly deps: {
      /** The open folder; tasks belong to it. */
      root: () => string | null
      /** The folder of a project session, null for chat sessions and unknown ones. */
      sessionRoot: (sessionId: string) => string | null
      onChanged: () => void
      now?: () => number
    }
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private requireRoot(): string {
    const root = this.deps.root()
    if (!root) throw new AppError('no_workspace', t('Open a folder first'))
    return root
  }

  private row(id: string): TodoRow {
    const row = this.db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | undefined
    if (!row) throw new AppError('not_found', t('This task no longer exists'))
    return row
  }

  private lastPosition(root: string): number {
    const r = this.db.prepare('SELECT MAX(position) AS p FROM todos WHERE root = ?').get(root) as { p: number | null }
    return r.p ?? 0
  }

  list(): Todo[] {
    const root = this.deps.root()
    if (!root) return []
    return (this.db.prepare('SELECT * FROM todos WHERE root = ? ORDER BY position, created_at').all(root) as TodoRow[]).map(toTodo)
  }

  create(input: TodoCreate): Todo {
    const data = todoCreateSchema.parse(input)
    const root = this.requireRoot()
    const id = randomUUID()
    const now = this.now()
    this.db
      .prepare(
        `INSERT INTO todos (id, root, text, status, session_id, origin, position, created_at, updated_at, done_at)
         VALUES (?, ?, ?, ?, NULL, 'user', ?, ?, ?, ?)`
      )
      .run(id, root, data.text, data.status, Math.floor(this.lastPosition(root)) + 1, now, now, data.status === 'done' ? now : null)
    this.deps.onChanged()
    return toTodo(this.row(id))
  }

  /** Edits a task, or moves it (drag and drop: another column, before another task). */
  update(input: TodoUpdate): Todo {
    const data = todoUpdateSchema.parse(input)
    const row = this.row(data.id)
    const now = this.now()
    const status = data.status ?? row.status
    let position = row.position
    if (data.beforeId !== undefined || data.status !== undefined) {
      const column = (this.db.prepare('SELECT id, position FROM todos WHERE root = ? AND status = ? AND id != ? ORDER BY position, created_at').all(row.root, status, row.id) as Array<{
        id: string
        position: number
      }>)
      const at = data.beforeId ? column.findIndex((c) => c.id === data.beforeId) : -1
      if (at === -1) position = (column.at(-1)?.position ?? this.lastPosition(row.root)) + 1
      else position = at === 0 ? (column[0]?.position ?? 0) - 1 : ((column[at - 1]?.position ?? 0) + (column[at]?.position ?? 0)) / 2
    }
    const doneAt = status === row.status ? row.done_at : status === 'done' ? now : null
    this.db
      .prepare('UPDATE todos SET text = ?, status = ?, position = ?, done_at = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(data.text ?? row.text, status, position, doneAt, status === 'in_progress' ? row.active : null, now, row.id)
    this.deps.onChanged()
    return toTodo(this.row(row.id))
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM todos WHERE id = ?').run(id)
    this.deps.onChanged()
  }

  /** "Hand to the agent": the task joins that session's list (the agent is told separately). */
  assign(id: string, sessionId: string): Todo {
    this.row(id)
    this.db.prepare('UPDATE todos SET session_id = ?, updated_at = ? WHERE id = ?').run(sessionId, this.now(), id)
    this.deps.onChanged()
    return toTodo(this.row(id))
  }

  /** An agent's new list (the `todos` event): its tasks follow it. */
  applyList(sessionId: string, items: readonly TodoItem[]): void {
    const root = this.deps.sessionRoot(sessionId)
    if (!root) return
    const existing = this.db.prepare('SELECT * FROM todos WHERE session_id = ? AND root = ? ORDER BY position').all(sessionId, root) as TodoRow[]
    const adoptable = this.db.prepare("SELECT * FROM todos WHERE session_id IS NULL AND root = ? AND status != 'done'").all(root) as TodoRow[]
    const base = existing.length ? Math.floor(Math.min(...existing.map((r) => r.position))) : Math.floor(this.lastPosition(root)) + 1
    const now = this.now()
    const plan = reconcile(existing, items, base, now, adoptable)
    if (!plan.insert.length && !plan.update.length && !plan.remove.length && !plan.adopt.length) return
    this.db.transaction(() => {
      const insert = this.db.prepare(
        `INSERT INTO todos (id, root, text, status, session_id, origin, item_key, active, position, created_at, updated_at, done_at)
         VALUES (?, ?, ?, ?, ?, 'agent', ?, ?, ?, ?, ?, ?)`
      )
      for (const r of plan.insert) insert.run(randomUUID(), root, r.text, r.status, sessionId, r.item_key, r.active, r.position, now, now, r.done_at)
      for (const { id, patch } of plan.update) {
        const keys = Object.keys(patch) as Array<keyof typeof patch>
        this.db.prepare(`UPDATE todos SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => patch[k] ?? null), now, id)
      }
      const adopt = this.db.prepare('UPDATE todos SET session_id = ? WHERE id = ?')
      for (const id of plan.adopt) adopt.run(sessionId, id)
      const remove = this.db.prepare('DELETE FROM todos WHERE id = ?')
      for (const id of plan.remove) remove.run(id)
    })()
    this.deps.onChanged()
  }

  onAgentEvent({ sessionId, event }: AgentEventEnvelope): void {
    if (event.type === 'todos') this.applyList(sessionId, event.items)
  }
}
