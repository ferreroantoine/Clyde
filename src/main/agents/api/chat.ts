import type { ModelOption } from '@shared/profiles'

/** A tool offered to the model. `inputSchema` is a JSON Schema object. */
export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  /** Opaque vendor data to send back with the call, e.g. Gemini's `extra_content`. */
  extra?: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  name: string
  content: string
  isError: boolean
}

/** An image sent with a user message (chat attachments), base64 without the data: prefix. */
export interface ImageInput {
  mime: string
  data: string
}

/** Vendor-neutral conversation history; each adapter converts it to its own wire format. */
export type ChatMessage =
  | { role: 'user'; text: string; images?: ImageInput[] }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[] }
  | { role: 'tool'; results: ToolResult[] }

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'other'

export interface Usage {
  /** All input tokens, cached ones included. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type AdapterEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'done'; text: string; toolCalls: ToolCall[]; stopReason: StopReason; usage: Usage }

export interface ChatRequest {
  model: string
  system: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  signal: AbortSignal
}

/** One streaming model call. Implementations never run tools; the agent loop does. */
export interface ChatAdapter {
  stream(request: ChatRequest): AsyncGenerator<AdapterEvent>
  listModels(): Promise<ModelOption[]>
  /** The model's context window in tokens, when the provider tells it. */
  contextWindow?(model: string): Promise<number | null>
}

/** Parses streamed tool arguments; models occasionally send nothing for tools without parameters. */
export function parseToolInput(json: string): Record<string, unknown> {
  if (!json.trim()) return {}
  try {
    const value: unknown = JSON.parse(json)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { value }
  } catch {
    return { _raw: json }
  }
}
