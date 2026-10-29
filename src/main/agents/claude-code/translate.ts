import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '@shared/agent'

const MAX_RESULT_CHARS = 20_000

/** Flattens a tool_result content (string or blocks) into display text. */
export function toolResultText(content: unknown): string {
  let text: string
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    text = content
      .map((part: { type?: string; text?: string }) =>
        part?.type === 'text' ? (part.text ?? '') : part?.type === 'image' ? '[image]' : ''
      )
      .filter(Boolean)
      .join('\n')
  } else text = content == null ? '' : JSON.stringify(content)
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… [truncated]` : text
}

interface MessageState {
  /** Keys of the text blocks streamed so far, in order. */
  streamed: string[]
  /** How many complete text blocks have arrived for this message. */
  completed: number
}

/**
 * Turns the SDK message stream into panel events. Stateful: streamed deltas and the
 * complete assistant message that follows them share one key per text block, so the
 * complete text replaces the streamed one instead of being shown twice.
 */
export class MessageTranslator {
  private readonly messages = new Map<string, MessageState>()
  private streamingId: string | null = null
  private readonly blockKeys = new Map<number, string>()
  /** `total_cost_usd` is the session's running total; turns report the difference. */
  private costSoFar = 0

  private state(id: string): MessageState {
    let s = this.messages.get(id)
    if (!s) {
      s = { streamed: [], completed: 0 }
      this.messages.set(id, s)
    }
    return s
  }

  translate(msg: SDKMessage): AgentEvent[] {
    switch (msg.type) {
      case 'stream_event':
        return msg.parent_tool_use_id ? [] : this.streamEvent(msg.event)
      case 'assistant':
        return this.assistant(msg)
      case 'user':
        return this.user(msg)
      case 'result': {
        const turnCost = Math.max(0, msg.total_cost_usd - this.costSoFar)
        this.costSoFar = Math.max(this.costSoFar, msg.total_cost_usd)
        return [
          {
            type: 'turn_end',
            isError: msg.is_error,
            subtype: msg.subtype,
            errors: 'errors' in msg ? msg.errors : [],
            costUsd: turnCost,
            inputTokens:
              msg.usage.input_tokens +
              (msg.usage.cache_read_input_tokens ?? 0) +
              (msg.usage.cache_creation_input_tokens ?? 0),
            outputTokens: msg.usage.output_tokens,
            durationMs: msg.duration_ms
          }
        ]
      }
      case 'rate_limit_event': {
        const info = msg.rate_limit_info
        return [
          {
            type: 'rate_limit',
            status: info.status,
            resetsAt: info.resetsAt ?? null,
            utilization: info.utilization ?? null,
            limitType: info.rateLimitType ?? null
          }
        ]
      }
      case 'system':
        if (msg.subtype === 'init') {
          return [
            { type: 'init', model: msg.model, claudeCodeVersion: msg.claude_code_version, cwd: msg.cwd, tools: msg.tools }
          ]
        }
        if (msg.subtype === 'permission_denied') {
          const reason = 'reason' in msg && typeof msg.reason === 'string' ? msg.reason : 'Permission denied'
          return [{ type: 'permission_denied', toolUseId: msg.tool_use_id, toolName: msg.tool_name, reason }]
        }
        return []
      case 'auth_status':
        return msg.error ? [{ type: 'error', message: msg.error }] : []
      default:
        return []
    }
  }

  private streamEvent(event: Extract<SDKMessage, { type: 'stream_event' }>['event']): AgentEvent[] {
    switch (event.type) {
      case 'message_start':
        this.streamingId = event.message.id
        this.blockKeys.clear()
        return []
      case 'content_block_start': {
        if (!this.streamingId || event.content_block.type !== 'text') return []
        const s = this.state(this.streamingId)
        const key = `${this.streamingId}:${s.streamed.length}`
        s.streamed.push(key)
        this.blockKeys.set(event.index, key)
        return []
      }
      case 'content_block_delta': {
        const key = this.blockKeys.get(event.index)
        if (!key || event.delta.type !== 'text_delta') return []
        return [{ type: 'text_delta', key, text: event.delta.text }]
      }
      default:
        return []
    }
  }

  private assistant(msg: Extract<SDKMessage, { type: 'assistant' }>): AgentEvent[] {
    const out: AgentEvent[] = []
    const id = msg.message.id
    const subagent = msg.parent_tool_use_id
    for (const block of msg.message.content) {
      if (block.type === 'text' && !subagent) {
        const s = this.state(id)
        const key = s.streamed[s.completed] ?? `${id}:${s.completed}`
        s.completed++
        if (block.text) out.push({ type: 'text', key, text: block.text })
      } else if (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') {
        out.push({
          type: 'tool_call',
          toolUseId: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
          parentToolUseId: subagent
        })
      }
    }
    if (msg.error && !subagent) out.push({ type: 'error', message: describeAssistantError(msg.error) })
    return out
  }

  private user(msg: Extract<SDKMessage, { type: 'user' }>): AgentEvent[] {
    const content = msg.message.content
    if (!Array.isArray(content)) return []
    const out: AgentEvent[] = []
    for (const block of content) {
      if (block.type === 'tool_result') {
        out.push({
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          content: toolResultText(block.content),
          isError: block.is_error === true
        })
      }
    }
    return out
  }
}

export function describeAssistantError(error: string): string {
  switch (error) {
    case 'authentication_failed':
      return 'Claude Code is not signed in for this profile, or its key was rejected. Open Accounts to sign in or update the key.'
    case 'billing_error':
      return 'The account has a billing problem. Check it on claude.ai or in the Anthropic Console.'
    case 'rate_limit':
      return 'The account hit a usage limit. Wait for the reset or switch to another profile.'
    case 'overloaded':
      return 'The API is overloaded. Try again in a moment.'
    case 'model_not_found':
      return 'This model is not available for the profile. Pick another model.'
    default:
      return `Claude Code reported an error: ${error.replace(/_/g, ' ')}.`
  }
}
