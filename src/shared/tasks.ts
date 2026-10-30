import { z } from 'zod'
import { tk } from './i18n'
import { PERMISSION_LEVELS, type PermissionLevel } from './agent'
import { profileIdSchema, REASONING_EFFORTS, type ReasoningEffort } from './profiles'

export const agentIdSchema = z.uuid()
export const taskIdSchema = z.uuid()

const mcpTools = z
  .array(z.string().regex(/^mcp__[a-z0-9_-]+__.+$/).max(300))
  .max(500)
  .default([])

/** A saved agent: account, model, instructions, permission level and MCP tools (spec: "Un Agent = …"). */
export const agentDefinitionInputSchema = z.object({
  name: z.string().trim().min(1, tk('Name is required')).max(60),
  profileId: profileIdSchema,
  model: z.string().trim().max(200).default(''),
  /** Reasoning effort; empty leaves the model's default. */
  effort: z.enum(REASONING_EFFORTS).or(z.literal('')).default(''),
  systemPrompt: z.string().max(20_000).default(''),
  permissionLevel: z.enum(PERMISSION_LEVELS).default('validate-all'),
  mcpTools
})
export type AgentDefinitionInput = z.input<typeof agentDefinitionInputSchema>

export const agentDefinitionUpdateSchema = agentDefinitionInputSchema.partial().extend({ id: agentIdSchema })
export type AgentDefinitionUpdate = z.input<typeof agentDefinitionUpdateSchema>

export interface AgentDefinition {
  id: string
  name: string
  profileId: string
  model: string
  effort: ReasoningEffort | ''
  systemPrompt: string
  permissionLevel: PermissionLevel
  mcpTools: string[]
  createdAt: number
  updatedAt: number
}

export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: tk('To do'),
  in_progress: tk('In progress'),
  review: tk('To review'),
  done: tk('Done')
}
export type TaskOutcome = 'merged' | 'abandoned'

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, tk('Title is required')).max(120),
  /** The first message the agent receives. */
  description: z.string().trim().min(1, tk('Describe the task')).max(50_000),
  agentId: agentIdSchema
})
export type TaskInput = z.input<typeof taskInputSchema>

export interface Task {
  id: string
  title: string
  description: string
  agentId: string | null
  repoRoot: string
  /** The branch checked out when the task was created; merges go there. */
  baseBranch: string
  branch: string
  worktreePath: string
  status: TaskStatus
  outcome: TaskOutcome | null
  /** The live agent session working on it, if any. */
  sessionId: string | null
  /** Last thing worth telling the user, e.g. merge conflicts. */
  note: string | null
  mergeCommit: string | null
  createdAt: number
  updatedAt: number
}

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface TaskChange {
  path: string
  oldPath: string | null
  status: ChangeStatus
}

export interface TaskFileDiff {
  path: string
  original: string
  modified: string
  /** Binary or too large: the review shows a placeholder instead. */
  unsupported: boolean
}

export type MergeResult =
  | { ok: true; commit: string }
  | { ok: false; reason: string; conflicts: string[] }
