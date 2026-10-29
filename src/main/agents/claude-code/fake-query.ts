import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { QueryFn } from './provider'

/** Test double for the SDK's query(): runs a script that reads the prompt stream and calls hooks. */
export interface FakeContext {
  options: Options
  /** Next user message the session sends. */
  nextUser: () => Promise<SDKUserMessage | null>
  /** Calls the session's PreToolUse hook the way Claude Code would. */
  preToolUse: (toolName: string, toolInput: Record<string, unknown>, toolUseId: string) => Promise<unknown>
}

export function fakeQuery(script: (ctx: FakeContext) => AsyncGenerator<SDKMessage>) {
  const calls: Options[] = []
  const query = ((params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => {
    const options = params.options ?? {}
    calls.push(options)
    const prompt = typeof params.prompt === 'string' ? null : params.prompt[Symbol.asyncIterator]()
    const ctx: FakeContext = {
      options,
      nextUser: async () => {
        const next = await prompt?.next()
        return next && !next.done ? next.value : null
      },
      preToolUse: async (toolName, toolInput, toolUseId) => {
        const hook = options.hooks?.PreToolUse?.[0]?.hooks[0]
        if (!hook) throw new Error('no PreToolUse hook')
        return hook(
          {
            hook_event_name: 'PreToolUse',
            tool_name: toolName,
            tool_input: toolInput,
            tool_use_id: toolUseId,
            session_id: 'sdk-session',
            transcript_path: '',
            cwd: options.cwd ?? ''
          },
          toolUseId,
          { signal: new AbortController().signal }
        )
      }
    }
    const generator = script(ctx)
    return Object.assign(generator, {
      interrupt: async () => undefined,
      close: () => void generator.return(undefined),
      supportedModels: async () => [
        { value: 'default', displayName: 'Default (recommended)', description: 'Best overall' },
        { value: 'opus', displayName: 'Opus', description: 'Most capable' }
      ],
      accountInfo: async () => ({ email: 'me@example.com', subscriptionType: 'Pro' })
    })
  }) as unknown as QueryFn
  return { query, calls }
}

/** Builds SDK messages with only the fields the translator reads. */
export const sdk = {
  init: (model = 'claude-sonnet-5') =>
    ({ type: 'system', subtype: 'init', model, claude_code_version: '2.1.312', cwd: '/repo', tools: ['Bash', 'Read'] }) as unknown as SDKMessage,
  stream: (event: unknown) => ({ type: 'stream_event', event, parent_tool_use_id: null }) as unknown as SDKMessage,
  assistant: (id: string, content: unknown[], extra: Record<string, unknown> = {}) =>
    ({ type: 'assistant', message: { id, content }, parent_tool_use_id: null, ...extra }) as unknown as SDKMessage,
  toolResult: (toolUseId: string, content: unknown, isError = false) =>
    ({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
      parent_tool_use_id: null
    }) as unknown as SDKMessage,
  result: (extra: Record<string, unknown> = {}) =>
    ({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.0123,
      duration_ms: 1500,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
      ...extra
    }) as unknown as SDKMessage
}
