import { t } from '@shared/i18n'
import type { AgentEvent } from '@shared/agent'
import type { AgyEvent, AgyToolInfo } from './stream'

const MAX_RESULT_CHARS = 20_000

const clip = (text: string) => (text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… [truncated]` : text)

function asText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function errorText(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  const e = error as { message?: unknown; type?: unknown }
  return typeof e.message === 'string' ? e.message : JSON.stringify(error)
}

/** A sentence for the panel from what agy printed when a run fails. */
export function describeAgyFailure(text: string): string {
  if (/authentication (required|expired)|log back in|not signed in/i.test(text)) {
    return t('Antigravity is not signed in, or its sign-in expired. Open Accounts to sign in again.')
  }
  if (/credits balance is too low|quota/i.test(text)) return t('Antigravity hit a usage limit: {text}', { text })
  return text
}

/**
 * Turns one `agy -p` run's events into panel events. One translator per turn: agy runs once
 * per message, resuming the conversation by id.
 */
export class AgyTranslator {
  private readonly texts = new Map<number, string>()
  private readonly tools = new Map<number, string>()
  /** Set by the result event; the next turn resumes it. */
  conversationId: string | null = null
  /** The tool step running, to attach permission notices to. */
  activeTool: { id: string; name: string } | null = null
  sawResult = false

  constructor(private readonly turnKey: string) {}

  translate(event: AgyEvent): AgentEvent[] {
    switch (event.event) {
      case 'init':
        return []
      case 'step_update':
        return this.step(event)
      case 'result': {
        this.sawResult = true
        if (event.conversation_id) this.conversationId = event.conversation_id
        const status = (event.status ?? 'SUCCESS').toUpperCase()
        const usage = event.usage ?? {}
        const failed = status !== 'SUCCESS'
        const message = describeAgyFailure(errorText(event.error))
        return [
          {
            type: 'turn_end',
            isError: failed && status !== 'INTERRUPTED' && status !== 'CANCELED',
            subtype: status === 'SUCCESS' ? 'success' : status.toLowerCase(),
            errors: failed && message ? [message] : [],
            // A Google subscription has no per-turn price.
            costUsd: null,
            inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_tokens ?? 0),
            outputTokens: (usage.output_tokens ?? 0) + (usage.thinking_tokens ?? 0),
            durationMs: Math.round((event.duration_seconds ?? 0) * 1000),
            cacheReadTokens: usage.cache_read_tokens ?? 0
          }
        ]
      }
    }
  }

  private step(step: Extract<AgyEvent, { event: 'step_update' }>): AgentEvent[] {
    if (step.conversation_id) this.conversationId = step.conversation_id
    const index = step.step_index ?? -1
    const done = step.state === 'DONE'
    if (step.step_type === 'agent_response') {
      const key = `${this.turnKey}:${index}`
      const out: AgentEvent[] = []
      if (step.text_delta) {
        this.texts.set(index, (this.texts.get(index) ?? '') + step.text_delta)
        out.push({ type: 'text_delta', key, text: step.text_delta })
      }
      const text = this.texts.get(index)
      if (done && text) out.push({ type: 'text', key, text })
      return out
    }
    if (step.step_type === 'tool') {
      const info: AgyToolInfo = step.tool_info ?? {}
      const toolUseId = `${this.turnKey}:${index}`
      const out: AgentEvent[] = []
      if (!this.tools.has(index)) {
        const name = info.name ?? step.tool_name ?? 'tool'
        this.tools.set(index, name)
        const input = info.parameters && typeof info.parameters === 'object' ? (info.parameters as Record<string, unknown>) : {}
        out.push({ type: 'tool_call', toolUseId, name, input, parentToolUseId: null })
      }
      this.activeTool = done ? null : { id: toolUseId, name: this.tools.get(index) ?? 'tool' }
      if (done) {
        const failure = errorText(info.error)
        out.push({ type: 'tool_result', toolUseId, content: clip(failure || asText(info.output)), isError: !!failure })
      }
      return out
    }
    return []
  }
}
