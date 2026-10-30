import { z } from 'zod'
import { tk } from './i18n'
import { sessionIdSchema } from './agent'

/** The three columns of the Tasks view. */
export const TODO_STATUSES = ['todo', 'in_progress', 'done'] as const
export type TodoStatus = (typeof TODO_STATUSES)[number]
export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  todo: tk('To do'),
  in_progress: tk('In progress'),
  done: tk('Done')
}

/** One task of the open project, written by the user or kept by an agent in its list. */
export interface Todo {
  id: string
  text: string
  status: TodoStatus
  /** The session whose list it is in; null for the user's own tasks. */
  sessionId: string | null
  /** Who wrote it first: the user (kept even when the agent's list drops it) or an agent. */
  origin: 'user' | 'agent'
  /** For the task in progress: what the agent is doing ("Running the tests"). */
  active: string | null
  position: number
  createdAt: number
  updatedAt: number
  doneAt: number | null
}

export const todoIdSchema = z.uuid()

export const todoCreateSchema = z.object({
  text: z.string().trim().min(1, tk('Write the task')).max(500),
  status: z.enum(TODO_STATUSES).default('todo')
})
export type TodoCreate = z.input<typeof todoCreateSchema>

export const todoUpdateSchema = z.object({
  id: todoIdSchema,
  text: z.string().trim().min(1).max(500).optional(),
  status: z.enum(TODO_STATUSES).optional(),
  /** Drag and drop: goes before this task of the column, or last. */
  beforeId: todoIdSchema.nullable().optional()
})
export type TodoUpdate = z.input<typeof todoUpdateSchema>

export const todoAssignSchema = z.object({ id: todoIdSchema, sessionId: sessionIdSchema })
