import type { AgentEvent } from '@shared/agent'
import type { PermissionDecision, ToolRequest } from '../../permissions/engine'
import type { ApprovalOutcome, ApprovalQuestion } from '../../permissions/broker'
import type { AdapterEvent, ChatAdapter, ChatMessage, ToolCall, ToolResult, ToolSpec } from './chat'
import type { ToolOutput } from './tools'

export const MAX_STEPS = 50

export interface ApiSessionConfig {
  model: string
  system: string
  tools: ToolSpec[]
  maxSteps?: number
}

export interface ApiSessionDeps {
  adapter: ChatAdapter
  emit: (event: AgentEvent) => void
  /** The call in the permission engine's terms (base tools map to Read, Write, Bash…). */
  toEngine: (call: ToolCall) => ToolRequest
  decide: (tool: ToolRequest) => PermissionDecision
  ask: (question: ApprovalQuestion, signal: AbortSignal) => Promise<ApprovalOutcome>
  execute: (call: ToolCall, signal: AbortSignal, onOutput: (chunk: string) => void) => Promise<ToolOutput>
  describeError: (err: unknown) => string
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err as Error)?.name === 'AbortError' || (err as Error)?.name === 'APIUserAbortError'
}

/**
 * Atelier's own agent loop for API providers: stream a reply, run the tool calls it asks for
 * (each through the permission engine, and the user when it says "ask"), feed the results
 * back, and repeat until the model stops calling tools, a step limit, or an interrupt.
 */
export class ApiSession {
  private readonly history: ChatMessage[] = []
  private readonly queue: string[] = []
  private wake: (() => void) | null = null
  private closed = false
  private turn: AbortController | null = null
  private turnCount = 0

  constructor(
    private readonly cfg: ApiSessionConfig,
    private readonly deps: ApiSessionDeps
  ) {}

  async start(): Promise<void> {
    this.deps.emit({
      type: 'init',
      model: this.cfg.model,
      claudeCodeVersion: '',
      cwd: '',
      tools: this.cfg.tools.map((t) => t.name)
    })
    while (!this.closed) {
      const text = this.queue.shift()
      if (text === undefined) {
        await new Promise<void>((resolve) => (this.wake = resolve))
        this.wake = null
        continue
      }
      await this.runTurn(text)
    }
  }

  send(text: string): void {
    if (this.closed) return
    this.queue.push(text)
    this.wake?.()
  }

  async interrupt(): Promise<void> {
    this.turn?.abort()
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

  private async runTurn(text: string): Promise<void> {
    const controller = new AbortController()
    this.turn = controller
    const signal = controller.signal
    const turn = ++this.turnCount
    const started = Date.now()
    const totals = { inputTokens: 0, outputTokens: 0 }
    let subtype = 'success'
    const errors: string[] = []
    this.history.push({ role: 'user', text })

    try {
      for (let step = 0; ; step++) {
        if (step >= (this.cfg.maxSteps ?? MAX_STEPS)) {
          subtype = 'error_max_turns'
          errors.push(`Stopped after ${this.cfg.maxSteps ?? MAX_STEPS} steps without finishing.`)
          break
        }
        const key = `t${turn}s${step}:0`
        let done: Extract<AdapterEvent, { type: 'done' }> | null = null
        for await (const event of this.deps.adapter.stream({
          model: this.cfg.model,
          system: this.cfg.system,
          messages: this.history,
          tools: this.cfg.tools,
          signal
        })) {
          if (event.type === 'text_delta') this.deps.emit({ type: 'text_delta', key, text: event.text })
          else done = event
        }
        if (!done) throw new Error('The model stream ended without a reply')
        totals.inputTokens += done.usage.inputTokens
        totals.outputTokens += done.usage.outputTokens
        if (done.text) this.deps.emit({ type: 'text', key, text: done.text })
        this.history.push({ role: 'assistant', text: done.text, toolCalls: done.toolCalls })
        if (done.toolCalls.length === 0) {
          if (done.stopReason === 'max_tokens') {
            subtype = 'error_max_tokens'
            errors.push('The reply hit the output token limit.')
          }
          break
        }
        const results: ToolResult[] = []
        try {
          for (const call of done.toolCalls) {
            this.deps.emit({ type: 'tool_call', toolUseId: call.id, name: call.name, input: call.input, parentToolUseId: null })
            const output = await this.runTool(call, signal)
            results.push({ toolCallId: call.id, name: call.name, ...output })
            this.deps.emit({ type: 'tool_result', toolUseId: call.id, ...output })
          }
        } finally {
          // Every call needs a result in the history, or the next request is rejected.
          for (const call of done.toolCalls.slice(results.length)) {
            const output = { content: 'Interrupted by the user', isError: true }
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
      durationMs: Date.now() - started
    })
  }

  private async runTool(call: ToolCall, signal: AbortSignal): Promise<{ content: string; isError: boolean }> {
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
