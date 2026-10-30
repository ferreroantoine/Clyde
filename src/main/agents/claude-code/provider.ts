import { t } from '@shared/i18n'
import type {
  CanUseTool,
  HookCallback,
  McpServerConfig,
  Options,
  Query,
  SDKUserMessage,
  query as sdkQuery
} from '@anthropic-ai/claude-agent-sdk'
import { parseQuestions, type AgentEvent, type AgentQuestion } from '@shared/agent'
import type { ConnectionResult, ModelOption } from '@shared/profiles'
import type { PermissionDecision, ToolRequest } from '../../permissions/engine'
import type { ApprovalOutcome, ApprovalQuestion, QuestionAnswers } from '../../permissions/broker'
import { MessageTranslator } from './translate'
import { parseClaudeUsage, type LimitReading } from '@shared/limits'
import { authStatus as runAuthStatus, type AuthStatus } from './runtime'

export type QueryFn = typeof sdkQuery

/** The SDK is ESM-only and large, so main loads it on first use. */
export async function loadQuery(): Promise<QueryFn> {
  return (await import('@anthropic-ai/claude-agent-sdk')).query
}

/** Approvals can wait for the user far longer than the 600 s default hook timeout. */
const APPROVAL_TIMEOUT_S = 24 * 60 * 60

/** Claude Code's multiple-choice questions; hidden from sessions that have nobody to answer them. */
const ASK_TOOL = 'AskUserQuestion'

/** A prompt stream that never sends anything, for control requests only. */
async function* idlePrompt(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
  yield* []
}

export interface ProbeTarget {
  binary: string
  env: Record<string, string>
  cwd: string
}

/** Model list and account info straight from Claude Code. Starts the CLI but sends no prompt. */
export async function probeClaudeCode(query: QueryFn, target: ProbeTarget, timeoutMs = 60_000) {
  const abort = new AbortController()
  const q = query({
    prompt: idlePrompt(abort.signal),
    options: {
      cwd: target.cwd,
      env: target.env,
      pathToClaudeCodeExecutable: target.binary,
      settingSources: [],
      abortController: abort
    }
  })
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const [models, account] = await Promise.all([q.supportedModels(), q.accountInfo()])
    return {
      models: models.map(
        (m): ModelOption => ({
          value: m.value,
          displayName: m.displayName,
          description: m.description,
          ...(m.supportsEffort && m.supportedEffortLevels?.length ? { efforts: [...m.supportedEffortLevels] } : {})
        })
      ),
      account
    }
  } finally {
    clearTimeout(timer)
    q.close()
    abort.abort()
  }
}

/** Plan limits through the SDK's experimental /usage call, isolated here because its name will change. */
export async function readClaudeUsage(q: Pick<Query, 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'>): Promise<LimitReading[]> {
  const usage = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
  return parseClaudeUsage(usage)
}

/** Starts Claude Code for one profile without a prompt, reads its plan limits, and stops it. */
export async function probeClaudeLimits(query: QueryFn, target: ProbeTarget, timeoutMs = 60_000): Promise<{ readings: LimitReading[]; raw: unknown }> {
  const abort = new AbortController()
  const q = query({
    prompt: idlePrompt(abort.signal),
    options: { cwd: target.cwd, env: target.env, pathToClaudeCodeExecutable: target.binary, settingSources: [], abortController: abort }
  })
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const raw = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
    return { readings: parseClaudeUsage(raw), raw }
  } finally {
    clearTimeout(timer)
    q.close()
    abort.abort()
  }
}

export type FetchFn = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number }>

/** Checks a key against the Anthropic API (models endpoint, no tokens used). */
export async function checkApiKey(fetchFn: FetchFn, apiKey: string): Promise<{ ok: boolean; detail: string | null }> {
  let status: number
  try {
    ;({ status } = await fetchFn('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    }))
  } catch (err) {
    return { ok: false, detail: t('Could not reach the Anthropic API: {message}', { message: (err as Error).message }) }
  }
  if (status === 200) return { ok: true, detail: null }
  if (status === 401) return { ok: false, detail: t('The API key was rejected (401).') }
  if (status === 403) return { ok: false, detail: t('The API key is not allowed to use the API (403).') }
  return { ok: false, detail: t('The Anthropic API answered {status}.', { status }) }
}

export interface ConnectionDeps {
  query: () => Promise<QueryFn>
  fetch: FetchFn
  authStatus?: (binary: string, env: Record<string, string>) => Promise<AuthStatus>
}

/** "Test connection" for a Claude Code profile: sign-in state, key validity and available models. */
export async function testConnection(
  deps: ConnectionDeps,
  target: ProbeTarget & { apiKey: string | null }
): Promise<ConnectionResult> {
  const result: ConnectionResult = {
    ok: false,
    status: 'Not signed in',
    detail: null,
    email: null,
    organization: null,
    subscriptionType: null,
    models: [],
    checkedAt: Date.now()
  }
  const auth = await (deps.authStatus ?? runAuthStatus)(target.binary, target.env)
  result.email = auth.email
  result.organization = auth.orgName
  result.subscriptionType = auth.subscriptionType
  if (!auth.loggedIn) {
    result.detail = target.apiKey
      ? t('Claude Code did not accept the stored key.')
      : t('Open the sign-in terminal and log in with the account this profile should use.')
    return result
  }
  if (target.apiKey) {
    const key = await checkApiKey(deps.fetch, target.apiKey)
    if (!key.ok) {
      result.status = t('Key rejected')
      result.detail = key.detail
      return result
    }
  }
  try {
    const probe = await probeClaudeCode(await deps.query(), target)
    result.models = probe.models
    result.email ??= probe.account.email ?? null
    result.organization ??= probe.account.organization ?? null
    result.subscriptionType ??= probe.account.subscriptionType ?? null
  } catch (err) {
    result.status = t('Signed in')
    result.detail = t('Claude Code started but did not list its models: {message}', { message: (err as Error).message })
    return result
  }
  result.ok = true
  result.status = t('Signed in')
  return result
}

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const isClaudeEffort = (e: string | undefined): e is (typeof CLAUDE_EFFORTS)[number] => (CLAUDE_EFFORTS as readonly (string | undefined)[]).includes(e)

export interface SessionConfig extends ProbeTarget {
  model: string
  /** Claude's effort level (low to max); empty leaves Claude Code's default. */
  effort?: string
  /** Appended to Claude Code's system prompt. */
  appendSystemPrompt?: string
  mcpServers?: Record<string, McpServerConfig>
  /** Extra tools to hide, e.g. MCP tools outside the agent's allow-list. */
  disallowedTools?: string[]
  /** A Claude Code session id to continue (its file lives in the profile's config folder). */
  resume?: string
}

export interface SessionDeps {
  query: QueryFn
  emit: (event: AgentEvent) => void
  /** Plan limits read after each turn (subscription profiles). */
  onLimits?: (readings: LimitReading[]) => void
  decide: (tool: ToolRequest) => PermissionDecision
  ask: (question: ApprovalQuestion, signal: AbortSignal) => Promise<ApprovalOutcome>
  /** Shows AskUserQuestion to the user; without it the tool stays hidden (chat sessions). */
  question?: (toolUseId: string, questions: AgentQuestion[], signal: AbortSignal) => Promise<QuestionAnswers>
  log?: (line: string) => void
}

/**
 * One Claude Code conversation in streaming-input mode. Every tool call goes through the
 * PreToolUse hook, which applies the permission engine and waits for the user on "ask".
 * Hooks run before settings allow rules, so a profile's own settings cannot skip that check.
 */
export class ClaudeCodeSession {
  private readonly queue: SDKUserMessage[] = []
  private wake: (() => void) | null = null
  private closed = false
  private readonly abort = new AbortController()
  private readonly translator = new MessageTranslator()
  /** Tool calls the user approved in the hook; Claude Code may still route them to canUseTool. */
  private readonly approved = new Set<string>()
  private q: Query | null = null

  constructor(
    private readonly cfg: SessionConfig,
    private readonly deps: SessionDeps
  ) {}

  /** Starts the Claude Code process and forwards its messages until the session ends. */
  start(): Promise<void> {
    this.q = this.deps.query({ prompt: this.input(), options: this.options() })
    return this.pump(this.q)
  }

  send(text: string): void {
    if (this.closed) return
    this.queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
    this.wake?.()
  }

  async interrupt(): Promise<void> {
    await this.q?.interrupt()
  }

  /** Claude Code's own `/compact`: it summarizes the conversation and reports a compact boundary. */
  async compact(): Promise<void> {
    if (this.closed) return
    this.queue.push({ type: 'user', message: { role: 'user', content: '/compact' }, parent_tool_use_id: null })
    this.wake?.()
  }

  stop(): void {
    if (this.closed) return
    this.closed = true
    this.wake?.()
    this.q?.close()
    this.abort.abort()
  }

  private limitsReading = false

  /** Claude Code's structured /usage (experimental SDK call); one at a time, failures ignored. */
  private readLimits(q: Query): void {
    if (this.limitsReading) return
    this.limitsReading = true
    readClaudeUsage(q)
      .then((readings) => {
        if (readings.length) this.deps.onLimits?.(readings)
      })
      .catch((err: Error) => this.deps.log?.(`could not read usage limits: ${err.message}`))
      .finally(() => (this.limitsReading = false))
  }

  private async *input(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      const next = this.queue.shift()
      if (next) {
        yield next
        continue
      }
      await new Promise<void>((resolve) => (this.wake = resolve))
      this.wake = null
    }
  }

  private options(): Options {
    const preToolUse: HookCallback = async (input, _toolUseId, { signal }) => {
      if (input.hook_event_name !== 'PreToolUse') return {}
      // A question changes nothing: canUseTool shows it and waits for the answers.
      if (input.tool_name === ASK_TOOL && this.deps.question) return {}
      const tool = { name: input.tool_name, input: (input.tool_input ?? {}) as Record<string, unknown> }
      const verdict = this.deps.decide(tool)
      let outcome: ApprovalOutcome
      if (verdict.decision === 'allow') outcome = { behavior: 'allow' }
      else if (verdict.decision === 'deny') outcome = { behavior: 'deny', message: verdict.reason }
      else {
        outcome = await this.deps.ask(
          { toolUseId: input.tool_use_id, toolName: tool.name, input: tool.input, reason: verdict.reason },
          signal
        )
        if (outcome.behavior === 'allow') this.approved.add(input.tool_use_id)
      }
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: outcome.behavior,
          permissionDecisionReason: outcome.behavior === 'allow' ? t('Allowed by Clyde') : outcome.message
        }
      }
    }

    // Reached only for calls that settings "ask" rules or Claude Code's own checks still hold back.
    const canUseTool: CanUseTool = async (toolName, input, opts) => {
      const question = this.deps.question
      if (toolName === ASK_TOOL && question) {
        const questions = parseQuestions(input)
        if (!questions) return { behavior: 'deny', message: 'The questions are malformed.' }
        const answers = await question(opts.toolUseID, questions, opts.signal)
        return answers
          ? { behavior: 'allow', updatedInput: { ...input, answers } }
          : { behavior: 'deny', message: 'The user did not answer. Ask in a message instead, or go on with your best judgment.' }
      }
      if (this.approved.has(opts.toolUseID)) return { behavior: 'allow', updatedInput: input }
      const outcome = await this.deps.ask(
        {
          toolUseId: opts.toolUseID,
          toolName,
          input,
          reason: opts.title ?? opts.decisionReason ?? t('Claude Code asks for approval')
        },
        opts.signal
      )
      return outcome.behavior === 'allow' ? { behavior: 'allow', updatedInput: input } : outcome
    }

    return {
      cwd: this.cfg.cwd,
      env: this.cfg.env,
      pathToClaudeCodeExecutable: this.cfg.binary,
      ...(this.cfg.model ? { model: this.cfg.model } : {}),
      ...(isClaudeEffort(this.cfg.effort) ? { effort: this.cfg.effort } : {}),
      ...(this.cfg.resume ? { resume: this.cfg.resume } : {}),
      // Recent models omit their reasoning unless asked; the panel shows its summary between actions.
      thinking: { type: 'adaptive', display: 'summarized' },
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        snapshot: true,
        ...(this.cfg.appendSystemPrompt ? { append: this.cfg.appendSystemPrompt } : {})
      },
      settingSources: ['user', 'project', 'local'],
      permissionMode: 'default',
      includePartialMessages: true,
      disallowedTools: [...(this.deps.question ? [] : [ASK_TOOL]), ...(this.cfg.disallowedTools ?? [])],
      ...(this.cfg.mcpServers && Object.keys(this.cfg.mcpServers).length ? { mcpServers: this.cfg.mcpServers } : {}),
      hooks: { PreToolUse: [{ hooks: [preToolUse], timeout: APPROVAL_TIMEOUT_S }] },
      canUseTool,
      abortController: this.abort,
      stderr: (data) => this.deps.log?.(data.trimEnd())
    }
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const message of q) {
        for (const event of this.translator.translate(message)) this.deps.emit(event)
        // After each answer, and when Claude Code says a limit changed, read the plan's windows.
        if (this.deps.onLimits && (message.type === 'result' || message.type === 'rate_limit_event')) this.readLimits(q)
      }
    } catch (err) {
      if (!this.closed) this.deps.emit({ type: 'error', message: (err as Error).message })
      throw err
    } finally {
      this.closed = true
      this.wake?.()
    }
  }
}
