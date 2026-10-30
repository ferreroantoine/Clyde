/**
 * The part of the `codex app-server` v2 protocol Clyde uses, copied by hand from the
 * bindings `codex app-server generate-ts` produces (Codex CLI 0.165.0). Fields Clyde does
 * not read are left out; unknown fields and item types are ignored at runtime.
 */

export interface InitializeResponse {
  userAgent: string
  codexHome: string
  platformFamily: string
  platformOs: string
}

export type AskForApproval = 'untrusted' | 'on-request' | 'never'
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export interface ThreadStartParams {
  model?: string | null
  cwd?: string | null
  approvalPolicy?: AskForApproval | null
  sandbox?: SandboxMode | null
  config?: Record<string, unknown> | null
  developerInstructions?: string | null
  ephemeral?: boolean | null
}

/** `thread/resume`: the same overrides as `thread/start`, plus the thread to read back. */
export interface ThreadResumeParams extends ThreadStartParams {
  threadId: string
  /** Only the thread's metadata: Clyde already shows its turns. */
  excludeTurns?: boolean
}

export interface ThreadStartResponse {
  thread: { id: string }
  model: string
  cwd: string
}

export interface UserTextInput {
  type: 'text'
  text: string
  text_elements: never[]
}

export interface TurnStartResponse {
  turn: Turn
}

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress'

export interface TurnError {
  message: string
  codexErrorInfo: unknown
  additionalDetails: string | null
}

export interface Turn {
  id: string
  status: TurnStatus
  error: TurnError | null
  durationMs: number | null
}

export interface FileUpdateChange {
  path: string
  kind: { type: 'add' } | { type: 'delete' } | { type: 'update'; move_path: string | null }
  diff: string
}

export type ThreadItem =
  | { type: 'userMessage'; id: string }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | { type: 'plan'; id: string; text: string }
  | {
      type: 'commandExecution'
      id: string
      command: string
      cwd: string
      status: 'inProgress' | 'completed' | 'failed' | 'declined'
      aggregatedOutput: string | null
      exitCode: number | null
    }
  | { type: 'fileChange'; id: string; changes: FileUpdateChange[]; status: 'inProgress' | 'completed' | 'failed' | 'declined' }
  | {
      type: 'mcpToolCall'
      id: string
      server: string
      tool: string
      status: 'inProgress' | 'completed' | 'failed'
      arguments: unknown
      result: { content: unknown[] } | null
      error: { message: string } | null
    }
  | { type: 'webSearch'; id: string; query: string }
  | { type: 'contextCompaction'; id: string }
  | { type: 'imageView'; id: string; path: string }
  | { type: string; id: string }

export interface TokenUsageBreakdown {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export interface ThreadTokenUsage {
  total: TokenUsageBreakdown
  last: TokenUsageBreakdown
  modelContextWindow: number | null
}

export interface RateLimitWindow {
  usedPercent: number
  windowDurationMins: number | null
  /** Unix seconds. */
  resetsAt: number | null
}

export interface RateLimitSnapshot {
  limitId: string | null
  limitName: string | null
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
  planType: string | null
}

export interface GetAccountRateLimitsResponse {
  rateLimits: RateLimitSnapshot
  /** Extra buckets, e.g. per model, keyed by limit id. */
  rateLimitsByLimitId: Record<string, RateLimitSnapshot | undefined> | null
}

export interface GetAccountResponse {
  account: { type: 'chatgpt'; email: string | null; planType: string } | { type: string } | null
  requiresOpenaiAuth: boolean
}

export interface Model {
  id: string
  model: string
  displayName: string
  description: string
  hidden: boolean
  isDefault: boolean
  /** Levels the model accepts for `turn/start`'s `effort`, with Codex's own description. */
  supportedReasoningEfforts?: { reasoningEffort: string; description: string }[]
  defaultReasoningEffort?: string
}

export interface ModelListResponse {
  data: Model[]
  nextCursor: string | null
}

/** Server notifications Clyde reads. */
export interface Notifications {
  'turn/plan/updated': { threadId: string; turnId: string; explanation: string | null; plan: Array<{ step: string; status: 'pending' | 'inProgress' | 'completed' }> }
  'item/started': { item: ThreadItem; threadId: string; turnId: string }
  'item/completed': { item: ThreadItem; threadId: string; turnId: string }
  'item/agentMessage/delta': { threadId: string; turnId: string; itemId: string; delta: string }
  'item/reasoning/summaryTextDelta': { threadId: string; turnId: string; itemId: string; delta: string; summaryIndex: number }
  'item/commandExecution/outputDelta': { threadId: string; turnId: string; itemId: string; delta: string }
  'turn/started': { threadId: string; turn: Turn }
  'turn/completed': { threadId: string; turn: Turn }
  'thread/tokenUsage/updated': { threadId: string; turnId: string; tokenUsage: ThreadTokenUsage }
  'account/rateLimits/updated': { rateLimits: RateLimitSnapshot }
  error: { error: TurnError; willRetry: boolean; threadId: string; turnId: string }
  warning: { threadId?: string; message: string }
  configWarning: { summary: string; details: string | null }
}

export type CommandApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

export interface CommandApprovalParams {
  threadId: string
  turnId: string
  itemId: string
  reason?: string | null
  command?: string | null
  cwd?: string | null
}

export interface FileChangeApprovalParams {
  threadId: string
  turnId: string
  itemId: string
  reason?: string | null
  grantRoot?: string | null
}

export interface PermissionsApprovalParams {
  threadId: string
  turnId: string
  itemId: string
  cwd: string
  reason: string | null
  permissions: { network: unknown; fileSystem: unknown }
}
