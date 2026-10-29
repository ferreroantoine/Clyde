import { z } from 'zod'
import { profileIdSchema, type ProfileKind } from './profiles'

/**
 * Per-agent permission levels from the spec. Reads inside the working directory are always allowed.
 * - validate-all: every file write and every shell command asks first.
 * - files-auto: file writes inside the working directory run, shell commands ask.
 * - autonomous: anything inside the working directory runs; file tools aimed outside it,
 *   `git push` and commands that leave the directory are refused.
 */
export const PERMISSION_LEVELS = ['validate-all', 'files-auto', 'autonomous'] as const
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]

export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
  'validate-all': 'Validate everything',
  'files-auto': 'Files auto, commands validated',
  autonomous: 'Autonomous in its folder'
}

export const sessionIdSchema = z.string().regex(/^as-[a-z0-9-]{1,40}$/)

export const agentStartSchema = z.object({
  profileId: profileIdSchema,
  /** Empty uses the profile's default model, then Claude Code's. */
  model: z.string().trim().max(200).default(''),
  permissionLevel: z.enum(PERMISSION_LEVELS).default('validate-all'),
  /** Defaults to the open workspace. */
  cwd: z.string().max(4096).optional(),
  /** Added to the default system prompt. */
  systemPrompt: z.string().max(20_000).default(''),
  /** MCP tools this agent may use, as `mcp__<server>__<tool>`. Nothing else from MCP is visible to it. */
  mcpTools: z
    .array(z.string().regex(/^mcp__[a-z0-9_-]+__.+$/).max(300))
    .max(500)
    .default([])
})
export type AgentStart = z.input<typeof agentStartSchema>

export const approvalAnswerSchema = z.object({
  sessionId: sessionIdSchema,
  requestId: z.string().min(1).max(64),
  decision: z.enum(['allow-once', 'allow-session', 'deny']),
  /** Sent to the agent with a denial. */
  message: z.string().max(2000).optional()
})
export type ApprovalAnswer = z.input<typeof approvalAnswerSchema>
export type ApprovalDecision = ApprovalAnswer['decision']

export type AgentStatus = 'starting' | 'idle' | 'running' | 'awaiting-approval' | 'stopped' | 'error'

export interface AgentSessionInfo {
  id: string
  profileId: string
  kind: ProfileKind
  model: string
  permissionLevel: PermissionLevel
  cwd: string
  mcpTools: string[]
  status: AgentStatus
  createdAt: number
}

export interface ToolCallInfo {
  toolUseId: string
  name: string
  input: Record<string, unknown>
  /** Set when the call comes from a subagent. */
  parentToolUseId: string | null
}

/** Everything the agent panel renders, pushed from main as `agent:event`. */
export type AgentEvent =
  | { type: 'status'; status: AgentStatus }
  | { type: 'init'; model: string; claudeCodeVersion: string; cwd: string; tools: string[] }
  | { type: 'user'; id: string; text: string }
  /** Streaming text; `key` identifies one text block of one assistant message. */
  | { type: 'text_delta'; key: string; text: string }
  /** The complete text of a block, replacing what the deltas built. */
  | { type: 'text'; key: string; text: string }
  | ({ type: 'tool_call' } & ToolCallInfo)
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | {
      type: 'approval_request'
      requestId: string
      toolUseId: string
      toolName: string
      input: Record<string, unknown>
      reason: string
    }
  | { type: 'approval_resolved'; requestId: string; decision: ApprovalDecision | 'cancelled' }
  | { type: 'permission_denied'; toolUseId: string; toolName: string; reason: string }
  | {
      type: 'turn_end'
      isError: boolean
      /** e.g. success, error_during_execution, error_max_turns. */
      subtype: string
      errors: string[]
      /** Claude Code reports the cost; null for API providers until pricing arrives. */
      costUsd: number | null
      inputTokens: number
      outputTokens: number
      durationMs: number
    }
  | {
      type: 'rate_limit'
      status: 'allowed' | 'allowed_warning' | 'rejected'
      resetsAt: number | null
      utilization: number | null
      limitType: string | null
    }
  | { type: 'error'; message: string }

export interface AgentEventEnvelope {
  sessionId: string
  /** Increases by one per event within a session, so the renderer can drop duplicates. */
  seq: number
  event: AgentEvent
}
