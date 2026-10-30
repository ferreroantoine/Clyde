import { z } from 'zod'
import { tk } from './i18n'
import { PERMISSION_LEVELS, type PermissionLevel } from './agent'
import { profileIdSchema, REASONING_EFFORTS, type ReasoningEffort } from './profiles'

export const agentIdSchema = z.uuid()

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
