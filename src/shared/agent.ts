import { z } from 'zod'
import { tk } from './i18n'
import { profileIdSchema, REASONING_EFFORTS, type ProfileKind, type ReasoningEffort } from './profiles'

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
  'validate-all': tk('Validate everything'),
  'files-auto': tk('Files auto, commands validated'),
  autonomous: tk('Autonomous in its folder')
}

/**
 * What each level means for Antigravity, which cannot ask for approval in headless mode:
 * anything that would need it is refused instead.
 */
export const ANTIGRAVITY_LEVEL_HINTS: Record<PermissionLevel, string> = {
  'validate-all': tk('Antigravity cannot ask: it only reads.'),
  'files-auto': tk('Edits files in its folder; commands are refused (it cannot ask).'),
  autonomous: tk('Edits and runs commands in its folder; git push is refused.')
}

export const sessionIdSchema = z.string().regex(/^as-[a-z0-9-]{1,40}$/)

export const agentStartSchema = z.object({
  profileId: profileIdSchema,
  /** Empty uses the profile's default model, then Claude Code's. */
  model: z.string().trim().max(200).default(''),
  /** Reasoning effort; empty leaves the model's own default. */
  effort: z.enum(REASONING_EFFORTS).or(z.literal('')).default(''),
  permissionLevel: z.enum(PERMISSION_LEVELS).default('validate-all'),
  /** Defaults to the open workspace. */
  cwd: z.string().max(4096).optional(),
  /** Added to the default system prompt. */
  systemPrompt: z.string().max(20_000).default(''),
  /** The saved agent and the board task this session works for, if any. */
  agentId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  /**
   * The chat conversation this session answers, if any. A chat session only reads (files in its
   * own folder, which holds the attachments) and uses the MCP tools it was given; it never
   * writes files or runs commands, and it never asks for approval.
   */
  chatId: z.uuid().optional(),
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

/** Moves a session to another account (and model): the agent goes on with what it was doing. */
export const agentSwitchSchema = z.object({
  sessionId: sessionIdSchema,
  profileId: profileIdSchema,
  model: z.string().trim().max(200).default(''),
  effort: z.enum(REASONING_EFFORTS).or(z.literal('')).default(''),
  /** Also tells the agent to carry on with its task. */
  carryOn: z.boolean().default(false)
})
export type AgentSwitch = z.input<typeof agentSwitchSchema>

/** What Clyde does when an account hits its usage limit in the middle of a task. */
export const LIMIT_ACTIONS = ['ask', 'wait', 'switch'] as const
export type LimitAction = (typeof LIMIT_ACTIONS)[number]
export type ApprovalDecision = ApprovalAnswer['decision']

/** One question an agent asks with choices: Claude Code's AskUserQuestion, or ask_user in Clyde's loop. */
export const agentQuestionSchema = z.object({
  question: z.string().min(1).max(2000),
  /** A short tag shown above the question. */
  header: z.string().max(60).default(''),
  options: z
    .array(z.object({ label: z.string().min(1).max(200), description: z.string().max(1000).default('') }))
    .min(1)
    .max(8),
  multiSelect: z.boolean().default(false)
})
export type AgentQuestion = z.infer<typeof agentQuestionSchema>

/** The questions of a tool call, or null when its input is not a valid list of them. */
export function parseQuestions(input: unknown): AgentQuestion[] | null {
  const parsed = z.array(agentQuestionSchema).min(1).max(4).safeParse((input as { questions?: unknown } | null)?.questions)
  return parsed.success ? parsed.data : null
}

export const questionAnswerSchema = z.object({
  sessionId: sessionIdSchema,
  requestId: z.string().min(1).max(64),
  /** Keyed by question text; several choices are joined with ", ". Null: the user skipped the questions. */
  answers: z.record(z.string().max(2000), z.string().max(10_000)).nullable()
})
export type QuestionAnswer = z.input<typeof questionAnswerSchema>

/** `interrupted`: Clyde closed (or crashed) while the agent was working; the session can be resumed. */
export type AgentStatus = 'starting' | 'idle' | 'running' | 'awaiting-approval' | 'stopped' | 'error' | 'interrupted'

/** Statuses of a session that no longer runs; it may still be resumed. */
export const ENDED_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>(['stopped', 'error', 'interrupted'])
export const isEnded = (status: AgentStatus): boolean => ENDED_STATUSES.has(status)
/** A session that is busy: quitting now cuts its work. */
export const isBusy = (status: AgentStatus): boolean => status === 'running' || status === 'awaiting-approval' || status === 'starting'

/** A past or live session of the agent panel's list. */
export interface SessionSummary {
  id: string
  profileId: string
  kind: ProfileKind
  model: string
  title: string | null
  status: AgentStatus
  cwd: string
  taskId: string | null
  startedAt: number
  endedAt: number | null
  /** Whether "Resume" can bring it back (Clyde knows how it was started). */
  resumable: boolean
}

/** A session from the history, to show it in the panel before resuming it. */
export interface StoredSession {
  info: AgentSessionInfo
  title: string | null
  resumable: boolean
  events: AgentEventEnvelope[]
}

export interface AgentSessionInfo {
  id: string
  profileId: string
  kind: ProfileKind
  model: string
  /** Reasoning effort asked for; empty is the model's default. */
  effort: ReasoningEffort | ''
  permissionLevel: PermissionLevel
  cwd: string
  mcpTools: string[]
  agentId: string | null
  taskId: string | null
  chatId: string | null
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

/**
 * An image a tool returned (a screenshot, an image file it read). Sessions hand the manager
 * its bytes (`data`, base64) or a file (`path`); the manager stores it and passes on only `id`,
 * which `agent:media` reads back.
 */
export interface ToolImage {
  mime: string
  id?: string
  data?: string
  path?: string
}

/** Tokens of one request by part, estimated from sizes and scaled to the reported input. */
export interface ContextBreakdown {
  system: number
  memory: number
  tools: number
  history: number
  toolResults: number
  output: number
}

/** Everything the agent panel renders, pushed from main as `agent:event`. */
export type AgentEvent =
  | { type: 'status'; status: AgentStatus }
  | {
      type: 'init'
      model: string
      /** Version of the CLI behind the session; empty for API agents. */
      cliVersion: string
      cwd: string
      tools: string[]
      /** The CLI's own id for the conversation (Claude Code session, Codex thread, agy conversation), to resume it. */
      resumeId?: string
    }
  /** The session came back after it ended; `fresh` when the agent only got a summary of what came before. */
  | { type: 'session_resumed'; fresh: boolean }
  /** The session goes on with another account or model; `full` when the agent kept its whole conversation. */
  | { type: 'account_switched'; profileId: string; profileName: string; model: string; full: boolean }
  /** The account hit a usage limit; `resetsAt` (ms) when known. The panel offers to switch or wait. */
  | { type: 'limit_reached'; resetsAt: number | null }
  | { type: 'user'; id: string; text: string }
  /** Streaming text; `key` identifies one text block of one assistant message. */
  | { type: 'text_delta'; key: string; text: string }
  /** The complete text of a block, replacing what the deltas built. */
  | { type: 'text'; key: string; text: string }
  /** The model's reasoning between actions (a summary for most providers), keyed like text. */
  | { type: 'thinking_delta'; key: string; text: string }
  | { type: 'thinking'; key: string; text: string }
  | ({ type: 'tool_call' } & ToolCallInfo)
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean; /** Screenshots and other images the tool returned. */ images?: ToolImage[] }
  /** Live output of a command, while it runs (API agents; Claude Code reports output at the end). */
  | { type: 'tool_output'; toolUseId: string; chunk: string }
  | {
      type: 'approval_request'
      requestId: string
      toolUseId: string
      toolName: string
      input: Record<string, unknown>
      reason: string
    }
  | { type: 'approval_resolved'; requestId: string; decision: ApprovalDecision | 'cancelled' }
  /** The agent asks the user to choose; the tool call waits for `agent:answerQuestion`. */
  | { type: 'question_request'; requestId: string; toolUseId: string; questions: AgentQuestion[] }
  /** Null when the questions were skipped or the session stopped waiting. */
  | { type: 'question_resolved'; requestId: string; answers: Record<string, string> | null }
  | { type: 'permission_denied'; toolUseId: string; toolName: string; reason: string }
  | {
      type: 'turn_end'
      isError: boolean
      /** e.g. success, error_during_execution, error_max_turns. */
      subtype: string
      errors: string[]
      /** Claude Code reports the cost; null for API providers until pricing arrives. */
      costUsd: number | null
      /** All input tokens of the turn, cached ones included. */
      inputTokens: number
      outputTokens: number
      durationMs: number
      /** Of `inputTokens`: read from the prompt cache, and written to it. 0 when the provider does not say. */
      cacheReadTokens?: number
      cacheWriteTokens?: number
      /** Size of the conversation after the turn, and the model's window, when known: the context gauge. */
      contextTokens?: number | null
      contextWindow?: number | null
      /** Where the last request's tokens went; Clyde's own loop only (CLIs report totals). */
      breakdown?: ContextBreakdown
    }
  | {
      type: 'rate_limit'
      status: 'allowed' | 'allowed_warning' | 'rejected'
      resetsAt: number | null
      utilization: number | null
      limitType: string | null
    }
  | { type: 'error'; message: string }
  /** Older turns were replaced by a summary (Clyde's loop), or the CLI compacted its context. */
  | { type: 'context_summarized'; turns: number }
  | { type: 'context_compacted' }

export interface AgentEventEnvelope {
  sessionId: string
  /** Increases by one per event within a session, so the renderer can drop duplicates. */
  seq: number
  event: AgentEvent
}
