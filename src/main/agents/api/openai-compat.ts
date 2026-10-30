import type OpenAI from 'openai'
import type { ModelOption, ReasoningEffort } from '@shared/profiles'
import { parseToolInput, type AdapterEvent, type ChatAdapter, type ChatMessage, type ChatRequest, type StopReason } from './chat'

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam

export type OpenAICompatKind = 'openai' | 'gemini' | 'ollama'

export function toOpenAIMessages(system: string, messages: ChatMessage[]): Message[] {
  const out: Message[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') {
      out.push(
        m.images?.length
          ? {
              role: 'user',
              content: [
                ...m.images.map((img) => ({ type: 'image_url' as const, image_url: { url: `data:${img.mime};base64,${img.data}` } })),
                { type: 'text' as const, text: m.text }
              ]
            }
          : { role: 'user', content: m.text }
      )
    }
    else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.toolCalls.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.input) },
                // Vendor data the model needs back, e.g. Gemini 3 thought signatures.
                ...(c.extra ? { extra_content: c.extra } : {})
              }))
            }
          : {})
      })
    } else {
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.isError ? `Error: ${r.content}` : r.content })
      }
    }
  }
  return out
}

function stopReason(reason: string | null | undefined): StopReason {
  if (reason === 'stop') return 'end'
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'other'
}

const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/i
const OPENAI_NOT_CHAT = /(audio|realtime|transcribe|tts|image|search|instruct|embedding|moderation)/i
const GEMINI_NOT_CHAT = /(embedding|tts|image|imagen|veo|live|transcribe|native-audio|robotics|aqa|translate)/i

interface RawModel {
  id: string
  created?: number
  name?: string | null
  description?: string | null
}

/** Keeps the models that can chat with tools, newest first. */
export function filterModels(kind: OpenAICompatKind, models: RawModel[]): ModelOption[] {
  // Gemini may list ids as `models/<id>`; requests take the bare id.
  const named = kind === 'gemini' ? models.map((m) => ({ ...m, id: m.id.replace(/^models\//, '') })) : models
  const usable = named.filter((m) => {
    if (kind === 'openai') return OPENAI_CHAT.test(m.id) && !OPENAI_NOT_CHAT.test(m.id)
    if (kind === 'gemini') return m.id.startsWith('gemini-') && !GEMINI_NOT_CHAT.test(m.id)
    return true
  })
  const seen = new Set<string>()
  return usable
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .map((m) => {
      const efforts = compatEfforts(kind, m.id)
      return { value: m.id, displayName: m.name || m.id, description: m.description ?? '', ...(efforts.length ? { efforts } : {}) }
    })
}

/**
 * Reasoning efforts by model name, as no listing says it. The levels every reasoning model of
 * the provider accepts: OpenAI's o-series and GPT-5 (minus the chat variants), and Gemini 2.5 and
 * later (minimal / none exist only on some, so they are left out).
 */
export function compatEfforts(kind: OpenAICompatKind, id: string): ReasoningEffort[] {
  if (kind === 'openai') return /^(o\d|gpt-5)/i.test(id) && !/chat/i.test(id) ? ['low', 'medium', 'high'] : []
  if (kind === 'gemini') return /^gemini-(2\.5|[3-9])/i.test(id) ? ['low', 'medium', 'high'] : []
  return []
}

/**
 * Ollama tells per model whether it thinks (`/api/show` capabilities). gpt-oss takes levels; the
 * other thinking models only turn it on or off.
 */
export function ollamaEfforts(id: string, capabilities: readonly string[]): ReasoningEffort[] {
  if (!capabilities.includes('thinking')) return []
  return /gpt-oss/i.test(id) ? ['low', 'medium', 'high'] : ['none', 'high']
}

/** OpenAI Chat Completions, which Gemini's compatibility endpoint and Ollama (`/v1`) also speak. */
export class OpenAICompatAdapter implements ChatAdapter {
  constructor(
    private readonly client: OpenAI,
    private readonly kind: OpenAICompatKind,
    /** Ollama only: a model's capabilities from its native `/api/show`. */
    private readonly capabilities?: (model: string) => Promise<string[]>
  ) {}

  async *stream(req: ChatRequest): AsyncGenerator<AdapterEvent> {
    const stream = await this.client.chat.completions.create(
      {
        model: req.model,
        messages: toOpenAIMessages(req.system, req.messages),
        ...(req.tools.length
          ? {
              tools: req.tools.map((t) => ({
                type: 'function' as const,
                function: { name: t.name, description: t.description, parameters: t.inputSchema }
              }))
            }
          : {}),
        stream: true,
        stream_options: { include_usage: true },
        // OpenAI and Gemini (ai.google.dev/gemini-api/docs/openai) and Ollama's /v1 all read it.
        ...(req.effort ? { reasoning_effort: req.effort } : {})
      },
      { signal: req.signal }
    )
    let text = ''
    let reason: StopReason = 'other'
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
    const calls = new Map<number, { id: string; name: string; args: string; extra?: Record<string, unknown> }>()
    for await (const chunk of stream) {
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? 0
        usage.outputTokens = chunk.usage.completion_tokens ?? 0
        // OpenAI caches long prefixes by itself; Gemini's compatible endpoint reports its implicit cache the same way.
        usage.cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
      }
      const choice = chunk.choices[0]
      if (!choice) continue
      const delta = choice.delta
      if (delta?.content) {
        text += delta.content
        yield { type: 'text_delta', text: delta.content }
      }
      for (const tc of delta?.tool_calls ?? []) {
        const current = calls.get(tc.index) ?? { id: '', name: '', args: '' }
        if (tc.id) current.id = tc.id
        if (tc.function?.name) current.name += tc.function.name
        if (tc.function?.arguments) current.args += tc.function.arguments
        const extra = (tc as { extra_content?: unknown }).extra_content
        if (extra && typeof extra === 'object') current.extra = { ...current.extra, ...(extra as Record<string, unknown>) }
        calls.set(tc.index, current)
      }
      if (choice.finish_reason) reason = stopReason(choice.finish_reason)
    }
    const toolCalls = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, c]) => ({
        id: c.id || `call_${index}`,
        name: c.name,
        input: parseToolInput(c.args),
        ...(c.extra ? { extra: c.extra } : {})
      }))
    // Some servers end a tool-calling turn with "stop"; the calls decide.
    if (toolCalls.length && reason === 'end') reason = 'tool_use'
    yield { type: 'done', text, toolCalls, stopReason: reason, usage }
  }

  async listModels(): Promise<ModelOption[]> {
    const raw: RawModel[] = []
    for await (const model of this.client.models.list()) raw.push(model as unknown as RawModel)
    const models = filterModels(this.kind, raw)
    const capabilities = this.capabilities
    if (!capabilities) return models
    return Promise.all(
      models.map(async (m) => {
        const efforts = ollamaEfforts(m.value, await capabilities(m.value).catch(() => []))
        return efforts.length ? { ...m, efforts } : m
      })
    )
  }
}
