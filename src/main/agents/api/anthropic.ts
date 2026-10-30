import type Anthropic from '@anthropic-ai/sdk'
import type { ModelOption, ReasoningEffort } from '@shared/profiles'
import { parseToolInput, type AdapterEvent, type ChatAdapter, type ChatMessage, type ChatRequest, type StopReason, type ToolCall } from './chat'

type MessageParam = Anthropic.MessageParam
type ContentBlockParam = Anthropic.ContentBlockParam

const MAX_TOKENS = 8192

/** Converts the neutral history. Consecutive user-role turns (tool results, then a new prompt) are merged. */
export function toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
  const out: MessageParam[] = []
  const push = (role: 'user' | 'assistant', blocks: ContentBlockParam[]) => {
    const last = out.at(-1)
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(...blocks)
    else out.push({ role, content: blocks })
  }
  for (const m of messages) {
    if (m.role === 'user') {
      const images: ContentBlockParam[] = (m.images ?? []).map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mime as 'image/png', data: img.data }
      }))
      push('user', [...images, { type: 'text', text: m.text }])
    }
    else if (m.role === 'assistant') {
      const blocks: ContentBlockParam[] = []
      if (m.text) blocks.push({ type: 'text', text: m.text })
      for (const call of m.toolCalls) blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
      if (blocks.length) push('assistant', blocks)
    } else {
      push(
        'user',
        m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.toolCallId, content: r.content, is_error: r.isError }))
      )
    }
  }
  return out
}

/**
 * Prompt caching: one breakpoint after the system prompt (it covers the tools, which come
 * first, and the system with its memory), one on the last block of the history, so each step
 * reads everything before it from the cache. Prefixes under the model's minimum are simply
 * not cached.
 */
export function withCacheBreakpoints(system: string, messages: MessageParam[]): { system: Anthropic.TextBlockParam[]; messages: MessageParam[] } {
  const cached = messages.map((m) => ({ ...m }))
  const last = cached.at(-1)
  if (last && Array.isArray(last.content) && last.content.length) {
    const blocks = [...last.content]
    const tail = blocks.at(-1) as ContentBlockParam & { cache_control?: unknown }
    blocks[blocks.length - 1] = { ...tail, cache_control: { type: 'ephemeral' } } as ContentBlockParam
    last.content = blocks
  }
  return { system: system ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : [], messages: cached }
}

function stopReason(reason: string | null | undefined): StopReason {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'end'
  if (reason === 'tool_use') return 'tool_use'
  if (reason === 'max_tokens') return 'max_tokens'
  return 'other'
}

const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number]
const isAnthropicEffort = (e: ReasoningEffort | undefined): e is AnthropicEffort => (ANTHROPIC_EFFORTS as readonly (string | undefined)[]).includes(e)

/** The effort levels a model lists in its capabilities (`/v1/models`). */
export function anthropicEfforts(effort: Anthropic.Models.EffortCapability | null | undefined): ReasoningEffort[] {
  if (!effort?.supported) return []
  return ANTHROPIC_EFFORTS.filter((level) => effort[level]?.supported)
}

export class AnthropicAdapter implements ChatAdapter {
  constructor(private readonly client: Anthropic) {}

  async *stream(req: ChatRequest): AsyncGenerator<AdapterEvent> {
    const stream = await this.client.messages.create(
      {
        model: req.model,
        max_tokens: MAX_TOKENS,
        ...withCacheBreakpoints(req.system, toAnthropicMessages(req.messages)),
        // Effort without extended thinking: the history keeps no thinking blocks to send back.
        ...(isAnthropicEffort(req.effort) ? { output_config: { effort: req.effort } } : {}),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema
        })),
        stream: true
      },
      { signal: req.signal }
    )
    let text = ''
    let reason: StopReason = 'other'
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    const tools = new Map<number, { id: string; name: string; json: string }>()
    for await (const event of stream) {
      switch (event.type) {
        case 'message_start':
          usage.inputTokens =
            event.message.usage.input_tokens +
            (event.message.usage.cache_read_input_tokens ?? 0) +
            (event.message.usage.cache_creation_input_tokens ?? 0)
          usage.outputTokens = event.message.usage.output_tokens
          usage.cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0
          usage.cacheWriteTokens = event.message.usage.cache_creation_input_tokens ?? 0
          break
        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            tools.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: '' })
          }
          break
        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            text += event.delta.text
            yield { type: 'text_delta', text: event.delta.text }
          } else if (event.delta.type === 'input_json_delta') {
            const tool = tools.get(event.index)
            if (tool) tool.json += event.delta.partial_json
          }
          break
        case 'message_delta':
          reason = stopReason(event.delta.stop_reason)
          usage.outputTokens = event.usage.output_tokens
          break
      }
    }
    const toolCalls: ToolCall[] = [...tools.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, t]) => ({ id: t.id, name: t.name, input: parseToolInput(t.json) }))
    yield { type: 'done', text, toolCalls, stopReason: reason, usage }
  }

  async listModels(): Promise<ModelOption[]> {
    const out: ModelOption[] = []
    for await (const model of this.client.models.list({ limit: 100 })) {
      const efforts = anthropicEfforts(model.capabilities?.effort)
      out.push({ value: model.id, displayName: model.display_name, description: '', ...(efforts.length ? { efforts } : {}) })
    }
    return out
  }
}
