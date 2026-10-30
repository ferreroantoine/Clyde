import { t } from '@shared/i18n'
import { parseQuestions, type AgentEvent, type AgentQuestion } from '@shared/agent'
import type { ReasoningEffort } from '@shared/profiles'
import type { PermissionDecision, ToolRequest } from '../../permissions/engine'
import type { ApprovalOutcome, ApprovalQuestion, QuestionAnswers } from '../../permissions/broker'
import type { AdapterEvent, ChatAdapter, ChatMessage, ImageInput, ToolCall, ToolResult, ToolSpec } from './chat'
import { ASK_USER, ASK_USER_SPEC, type ToolOutput } from './tools'
import {
  breakdown,
  compactToolResults,
  estimateRequestTokens,
  READ_TOOL_OUTPUT,
  READ_TOOL_OUTPUT_SPEC,
  splitForSummary,
  TOOL_RESULT_KEEP,
  transcriptText,
  withSummary
} from '../../context/history'

export const MAX_STEPS = 50

export interface ApiSessionConfig {
  model: string
  /** Reasoning effort; empty is the model's default. */
  effort?: ReasoningEffort | ''
  system: string
  /** The memory core, after the system prompt: same order every request, so it stays in the prompt cache. */
  memory?: string
  tools: ToolSpec[]
  maxSteps?: number
  /** Above this many tokens of history, older turns are replaced by a summary (0: never). */
  summarizeAt?: number
  /** Turns kept as they are when summarizing. */
  keepTurns?: number
  /** Tool results above this many characters are shortened once the model has read them. */
  toolResultKeep?: number
  contextWindow?: number | null
  /** The conversation so far, when the session is resumed. */
  history?: ChatMessage[]
}

export interface ApiSessionDeps {
  adapter: ChatAdapter
  emit: (event: AgentEvent) => void
  /** The call in the permission engine's terms (base tools map to Read, Write, Bash…). */
  toEngine: (call: ToolCall) => ToolRequest
  decide: (tool: ToolRequest) => PermissionDecision
  ask: (question: ApprovalQuestion, signal: AbortSignal) => Promise<ApprovalOutcome>
  /** Shows ask_user's questions; without it the model is not offered the tool (chat sessions). */
  question?: (toolUseId: string, questions: AgentQuestion[], signal: AbortSignal) => Promise<QuestionAnswers>
  execute: (call: ToolCall, signal: AbortSignal, onOutput: (chunk: string) => void) => Promise<ToolOutput>
  describeError: (err: unknown) => string
  /** Writes the rolling summary; a local model by default (Settings › Memory & context). */
  summarize?: (transcript: string, signal: AbortSignal) => Promise<string>
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err as Error)?.name === 'AbortError' || (err as Error)?.name === 'APIUserAbortError'
}

/**
 * Clyde's own agent loop for API providers: stream a reply, run the tool calls it asks for
 * (each through the permission engine, and the user when it says "ask"), feed the results
 * back, and repeat until the model stops calling tools, a step limit, or an interrupt.
 */
export class ApiSession {
  private history: ChatMessage[] = []
  /** Full outputs shortened in the history, for read_tool_output. */
  private readonly fullOutputs = new Map<string, string>()
  private readonly queue: Array<{ text: string; images: ImageInput[] }> = []
  private wake: (() => void) | null = null
  private closed = false
  private turn: AbortController | null = null
  private turnCount = 0

  constructor(
    private readonly cfg: ApiSessionConfig,
    private readonly deps: ApiSessionDeps
  ) {
    this.history = [...(cfg.history ?? [])]
  }

  async start(): Promise<void> {
    this.deps.emit({
      type: 'init',
      model: this.cfg.model,
      cliVersion: '',
      cwd: '',
      tools: this.cfg.tools.map((t) => t.name)
    })
    while (!this.closed) {
      const next = this.queue.shift()
      if (next === undefined) {
        await new Promise<void>((resolve) => (this.wake = resolve))
        this.wake = null
        continue
      }
      await this.runTurn(next.text, next.images)
    }
  }

  /** `images` go to the model with the message (chat attachments); vision models only. */
  send(text: string, images: ImageInput[] = []): void {
    if (this.closed) return
    this.queue.push({ text, images })
    this.wake?.()
  }

  async interrupt(): Promise<void> {
    this.turn?.abort()
  }

  /** "Compact" between turns: summarizes the older turns now, whatever the threshold. */
  async compact(): Promise<void> {
    if (this.turn || !this.deps.summarize) return
    const controller = new AbortController()
    await this.summarizeIfNeeded(controller.signal, true)
  }

  stop(): void {
    this.closed = true
    this.turn?.abort()
    this.wake?.()
  }

  /** The conversation so far, for tests. */
  messages(): readonly ChatMessage[] {
    return this.history
  }

  private get system(): string {
    return this.cfg.memory ? `${this.cfg.system}\n\n${this.cfg.memory}` : this.cfg.system
  }

  private get tools(): ToolSpec[] {
    return [...this.cfg.tools, READ_TOOL_OUTPUT_SPEC, ...(this.deps.question ? [ASK_USER_SPEC] : [])]
  }

  /** Shortens tool results the model already read; keeps the full text for read_tool_output. */
  private shortenToolResults(): void {
    const { history, cut } = compactToolResults(this.history, this.cfg.toolResultKeep ?? TOOL_RESULT_KEEP)
    for (const [id, text] of cut) this.fullOutputs.set(id, text)
    this.history = history
  }

  /** Replaces older turns by a summary when the history grows past the threshold. */
  private async summarizeIfNeeded(signal: AbortSignal, force = false): Promise<void> {
    const limit = this.cfg.summarizeAt ?? 0
    if (!this.deps.summarize || (!force && !limit)) return
    if (!force && estimateRequestTokens(this.system, this.tools, this.history) < limit) return
    const split = splitForSummary(this.history, this.cfg.keepTurns ?? 2)
    if (!split) return
    try {
      const summary = await this.deps.summarize(transcriptText(split.older), signal)
      if (summary.trim()) {
        this.history = withSummary(summary, split.recent)
        this.deps.emit({ type: 'context_summarized', turns: split.older.filter((m) => m.role === 'user').length })
      }
    } catch (err) {
      // Not fatal: the turn goes on with the full history.
      if (isAbort(err, signal)) throw err
    }
  }

  private async runTurn(text: string, images: ImageInput[]): Promise<void> {
    const controller = new AbortController()
    this.turn = controller
    const signal = controller.signal
    const turn = ++this.turnCount
    const started = Date.now()
    const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    let last: { input: number; output: number; parts: Parameters<typeof breakdown>[0] } | null = null
    let subtype = 'success'
    const errors: string[] = []

    try {
      await this.summarizeIfNeeded(signal)
      this.history.push(images.length ? { role: 'user', text, images } : { role: 'user', text })
      for (let step = 0; ; step++) {
        if (step >= (this.cfg.maxSteps ?? MAX_STEPS)) {
          subtype = 'error_max_turns'
          errors.push(t('Stopped after {steps} steps without finishing.', { steps: this.cfg.maxSteps ?? MAX_STEPS }))
          break
        }
        const key = `t${turn}s${step}:0`
        const thinkingKey = `t${turn}s${step}:th`
        let thinking = ''
        let done: Extract<AdapterEvent, { type: 'done' }> | null = null
        this.shortenToolResults()
        const request = { system: this.system, history: this.history, tools: this.tools }
        for await (const event of this.deps.adapter.stream({
          model: this.cfg.model,
          system: request.system,
          messages: request.history,
          tools: request.tools,
          signal,
          ...(this.cfg.effort ? { effort: this.cfg.effort } : {})
        })) {
          if (event.type === 'text_delta') this.deps.emit({ type: 'text_delta', key, text: event.text })
          else if (event.type === 'thinking_delta') {
            thinking += event.text
            this.deps.emit({ type: 'thinking_delta', key: thinkingKey, text: event.text })
          } else done = event
        }
        if (thinking.trim()) this.deps.emit({ type: 'thinking', key: thinkingKey, text: thinking })
        if (!done) throw new Error(t('The model stream ended without a reply'))
        totals.inputTokens += done.usage.inputTokens
        totals.outputTokens += done.usage.outputTokens
        totals.cacheReadTokens += done.usage.cacheReadTokens ?? 0
        totals.cacheWriteTokens += done.usage.cacheWriteTokens ?? 0
        last = {
          input: done.usage.inputTokens,
          output: done.usage.outputTokens,
          parts: { system: this.cfg.system, memory: this.cfg.memory ?? '', tools: request.tools, history: request.history }
        }
        if (done.text) this.deps.emit({ type: 'text', key, text: done.text })
        this.history.push({ role: 'assistant', text: done.text, toolCalls: done.toolCalls })
        if (done.toolCalls.length === 0) {
          if (done.stopReason === 'max_tokens') {
            subtype = 'error_max_tokens'
            errors.push(t('The reply hit the output token limit.'))
          }
          break
        }
        const results: ToolResult[] = []
        try {
          for (const call of done.toolCalls) {
            this.deps.emit({ type: 'tool_call', toolUseId: call.id, name: call.name, input: call.input, parentToolUseId: null })
            const { images, ...output } = await this.runTool(call, signal)
            // Images are for the panel; the history keeps the text, which every adapter can send.
            results.push({ toolCallId: call.id, name: call.name, ...output })
            this.deps.emit({ type: 'tool_result', toolUseId: call.id, ...output, ...(images?.length ? { images } : {}) })
          }
        } finally {
          // Every call needs a result in the history, or the next request is rejected.
          for (const call of done.toolCalls.slice(results.length)) {
            const output = { content: t('Interrupted by the user'), isError: true }
            results.push({ toolCallId: call.id, name: call.name, ...output })
            this.deps.emit({ type: 'tool_result', toolUseId: call.id, ...output })
          }
          this.history.push({ role: 'tool', results })
        }
      }
    } catch (err) {
      if (isAbort(err, signal)) {
        subtype = 'interrupted'
        errors.push('Interrupted.')
      } else {
        subtype = 'error_during_execution'
        const message = this.deps.describeError(err)
        errors.push(message)
        // Out of quota or rate limited: the limit guard may switch accounts or wait.
        if ((err as { status?: number }).status === 429) {
          this.deps.emit({ type: 'rate_limit', status: 'rejected', resetsAt: null, utilization: null, limitType: null })
        }
        this.deps.emit({ type: 'error', message })
      }
    } finally {
      this.turn = null
    }
    this.deps.emit({
      type: 'turn_end',
      isError: subtype !== 'success',
      subtype,
      errors,
      costUsd: null,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      durationMs: Date.now() - started,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      contextTokens: last ? last.input + last.output : null,
      contextWindow: this.cfg.contextWindow ?? null,
      ...(last ? { breakdown: breakdown(last.parts, last.input, last.output) } : {})
    })
  }

  private async runTool(call: ToolCall, signal: AbortSignal): Promise<ToolOutput> {
    // Reading back a shortened output needs no permission: it is the session's own history.
    if (call.name === READ_TOOL_OUTPUT) {
      const id = String(call.input['id'] ?? '')
      const full = this.fullOutputs.get(id)
      if (full === undefined) return { content: `No shortened output with id "${id}".`, isError: true }
      const offset = Math.max(0, Number(call.input['offset']) || 0)
      const part = full.slice(offset, offset + 30_000)
      const rest = full.length - offset - part.length
      return { content: rest > 0 ? `${part}\n… [${rest} more characters: call again with offset ${offset + part.length}]` : part, isError: false }
    }
    // A question changes nothing, so it needs no permission; the user answers it in the panel.
    const ask = this.deps.question
    if (call.name === ASK_USER && ask) {
      const questions = parseQuestions(call.input)
      if (!questions) return { content: 'Invalid questions: give 1 to 4, each with a question and 1 to 8 options with a label.', isError: true }
      const answers = await ask(call.id, questions, signal)
      if (signal.aborted) throw Object.assign(new Error('Interrupted'), { name: 'AbortError' })
      if (!answers) return { content: 'The user did not answer. Ask in a message instead, or go on with your best judgment.', isError: false }
      return { content: questions.map((q) => `${q.question}\n→ ${answers[q.question] ?? '(no answer)'}`).join('\n\n'), isError: false }
    }
    const request = this.deps.toEngine(call)
    const verdict = this.deps.decide(request)
    if (verdict.decision === 'deny') {
      this.deps.emit({ type: 'permission_denied', toolUseId: call.id, toolName: call.name, reason: verdict.reason })
      return { content: `Not allowed: ${verdict.reason}`, isError: true }
    }
    if (verdict.decision === 'ask') {
      const outcome = await this.deps.ask(
        { toolUseId: call.id, toolName: call.name, input: call.input, reason: verdict.reason },
        signal
      )
      if (signal.aborted) throw Object.assign(new Error('Interrupted'), { name: 'AbortError' })
      if (outcome.behavior === 'deny') return { content: `The user denied this call: ${outcome.message}`, isError: true }
    }
    const output = await this.deps.execute(call, signal, (chunk) =>
      this.deps.emit({ type: 'tool_output', toolUseId: call.id, chunk })
    )
    if (signal.aborted) throw Object.assign(new Error('Interrupted'), { name: 'AbortError' })
    return output
  }
}
