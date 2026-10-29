import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@shared/agent'
import { ApprovalBroker } from '../../permissions/broker'
import { decide } from '../../permissions/engine'
import { AnthropicAdapter, toAnthropicMessages } from './anthropic'
import { filterModels, OpenAICompatAdapter, toOpenAIMessages } from './openai-compat'
import { describeApiError, testApiConnection } from './clients'
import { parseToolInput, type AdapterEvent, type ChatAdapter, type ChatMessage, type ChatRequest } from './chat'
import { ApiSession } from './loop'
import { BaseToolExecutor, BASE_TOOLS, clip, defaultShell, toEngineRequest } from './tools'

async function* items<T>(list: T[]) {
  for (const item of list) yield item
}

async function collect(gen: AsyncGenerator<AdapterEvent>) {
  const out: AdapterEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const request = (messages: ChatMessage[] = [{ role: 'user', text: 'hi' }]): ChatRequest => ({
  model: 'm',
  system: 'sys',
  messages,
  tools: BASE_TOOLS.slice(0, 1),
  signal: new AbortController().signal
})

const history: ChatMessage[] = [
  { role: 'user', text: 'list files' },
  { role: 'assistant', text: 'Sure.', toolCalls: [{ id: 'c1', name: 'list_files', input: {} }] },
  { role: 'tool', results: [{ toolCallId: 'c1', name: 'list_files', content: 'a.ts', isError: false }] },
  { role: 'user', text: 'thanks' }
]

describe('wire formats', () => {
  it('converts history for Anthropic, merging consecutive user turns', () => {
    expect(toAnthropicMessages(history)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'list files' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Sure.' },
          { type: 'tool_use', id: 'c1', name: 'list_files', input: {} }
        ]
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'a.ts', is_error: false },
          { type: 'text', text: 'thanks' }
        ]
      }
    ])
  })

  it('converts history for OpenAI-compatible APIs', () => {
    expect(toOpenAIMessages('sys', history)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'list files' },
      {
        role: 'assistant',
        content: 'Sure.',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_files', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'c1', content: 'a.ts' },
      { role: 'user', content: 'thanks' }
    ])
  })

  it('parses tool arguments defensively', () => {
    expect(parseToolInput('')).toEqual({})
    expect(parseToolInput('{"a":1}')).toEqual({ a: 1 })
    expect(parseToolInput('[1]')).toEqual({ value: [1] })
    expect(parseToolInput('{oops')).toEqual({ _raw: '{oops' })
  })
})

describe('AnthropicAdapter', () => {
  it('streams text and assembles tool calls from JSON deltas', async () => {
    const create = vi.fn(async () =>
      items([
        { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 5 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Look' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'read_file', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"a.ts"}' } },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }
      ])
    )
    const adapter = new AnthropicAdapter({ messages: { create } } as unknown as Anthropic)
    const events = await collect(adapter.stream(request()))
    expect(events).toEqual([
      { type: 'text_delta', text: 'Look' },
      {
        type: 'done',
        text: 'Look',
        toolCalls: [{ id: 'tu1', name: 'read_file', input: { path: 'a.ts' } }],
        stopReason: 'tool_use',
        usage: { inputTokens: 15, outputTokens: 20 }
      }
    ])
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'm', system: 'sys', stream: true, tools: [expect.objectContaining({ name: 'read_file' })] }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('lists models', async () => {
    const adapter = new AnthropicAdapter({
      models: { list: () => items([{ id: 'claude-x', display_name: 'Claude X' }]) }
    } as unknown as Anthropic)
    await expect(adapter.listModels()).resolves.toEqual([{ value: 'claude-x', displayName: 'Claude X', description: '' }])
  })
})

describe('OpenAICompatAdapter', () => {
  const chunks = [
    { choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'run_', arguments: '{"comm' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'command', arguments: 'and":"ls"}' } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 30, completion_tokens: 7 } }
  ]

  it('assembles streamed tool calls and usage', async () => {
    const create = vi.fn(async () => items(chunks))
    const adapter = new OpenAICompatAdapter({ chat: { completions: { create } } } as unknown as OpenAI, 'openai')
    const events = await collect(adapter.stream(request()))
    expect(events.at(-1)).toEqual({
      type: 'done',
      text: 'Hi',
      toolCalls: [{ id: 'call_1', name: 'run_command', input: { command: 'ls' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 30, outputTokens: 7 }
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream_options: { include_usage: true } }), expect.anything())
  })

  it('keeps chat models, newest first', () => {
    expect(
      filterModels('openai', [
        { id: 'gpt-4o', created: 1 },
        { id: 'text-embedding-3-large', created: 3 },
        { id: 'gpt-5', created: 2 },
        { id: 'gpt-4o-realtime-preview', created: 4 },
        { id: 'whisper-1', created: 5 }
      ]).map((m) => m.value)
    ).toEqual(['gpt-5', 'gpt-4o'])
    expect(filterModels('ollama', [{ id: 'llama3.2' }, { id: 'qwen3' }]).map((m) => m.value)).toEqual(['llama3.2', 'qwen3'])
    expect(
      filterModels('gemini', [
        { id: 'models/gemini-3.8-flash' },
        { id: 'models/gemini-embedding-001' },
        { id: 'gemini-3.1-pro-preview' },
        { id: 'models/gemini-3.8-live' },
        { id: 'models/imagen-4.0-generate-001' },
        { id: 'models/gemini-2.5-flash-preview-tts' }
      ]).map((m) => m.value)
    ).toEqual(['gemini-3.8-flash', 'gemini-3.1-pro-preview'])
  })

  it('keeps vendor data on tool calls and sends it back (Gemini thought signatures)', async () => {
    const signed = [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'fc_1',
                  function: { name: 'list_files', arguments: '{}' },
                  extra_content: { google: { thought_signature: 'sig==' } }
                }
              ]
            },
            finish_reason: 'tool_calls'
          }
        ]
      }
    ]
    const create = vi.fn(async () => items(signed))
    const adapter = new OpenAICompatAdapter({ chat: { completions: { create } } } as unknown as OpenAI, 'gemini')
    const done = (await collect(adapter.stream(request()))).at(-1)
    const call = { id: 'fc_1', name: 'list_files', input: {}, extra: { google: { thought_signature: 'sig==' } } }
    expect(done).toMatchObject({ toolCalls: [call] })
    expect(toOpenAIMessages('sys', [{ role: 'assistant', text: '', toolCalls: [call] }])[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'fc_1',
          type: 'function',
          function: { name: 'list_files', arguments: '{}' },
          extra_content: { google: { thought_signature: 'sig==' } }
        }
      ]
    })
  })
})

describe('testApiConnection', () => {
  const target = { kind: 'ollama' as const, apiKey: null, baseUrl: 'http://localhost:11434' }
  it('reports the models', async () => {
    const adapter = { listModels: async () => [{ value: 'qwen3', displayName: 'qwen3', description: '' }] } as ChatAdapter
    await expect(testApiConnection(adapter, target)).resolves.toMatchObject({ ok: true, status: 'Connected' })
  })
  it('explains failures', async () => {
    const offline = { listModels: async () => Promise.reject(Object.assign(new Error('fetch failed'), { name: 'APIConnectionError' })) }
    await expect(testApiConnection(offline as unknown as ChatAdapter, target)).resolves.toMatchObject({
      ok: false,
      detail: 'Could not reach Ollama at http://localhost:11434. Is Ollama running?'
    })
    expect(describeApiError({ status: 401 }, { kind: 'openai', baseUrl: '' })).toMatch(/rejected/)
    const rejected = { listModels: async () => Promise.reject({ status: 401 }) }
    await expect(testApiConnection(rejected as unknown as ChatAdapter, { ...target, kind: 'openai' })).resolves.toMatchObject({
      status: 'Key rejected'
    })
  })
})

describe('base tools', () => {
  const setup = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'atelier-tools-'))
    mkdirSync(join(cwd, 'src'))
    mkdirSync(join(cwd, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(cwd, 'src', 'a.ts'), 'one\ntwo\nthree\n')
    const tools = new BaseToolExecutor(cwd, defaultShell(process.platform, false), { PATH: process.env['PATH'] ?? '' })
    return { cwd, tools, run: (name: string, input: Record<string, unknown>) => tools.run(name, input, new AbortController().signal) }
  }

  it('reads, writes, edits and lists files', async () => {
    const { cwd, run } = setup()
    expect(await run('read_file', { path: 'src/a.ts', offset: 2, limit: 1 })).toEqual({
      content: 'two\n[… 2 more lines]',
      isError: false
    })
    expect(await run('write_file', { path: 'new/b.txt', content: 'hello' })).toMatchObject({ isError: false })
    expect(readFileSync(join(cwd, 'new', 'b.txt'), 'utf8')).toBe('hello')
    expect(await run('edit_file', { path: 'src/a.ts', old_text: 'two', new_text: '2' })).toMatchObject({ isError: false })
    expect(readFileSync(join(cwd, 'src', 'a.ts'), 'utf8')).toBe('one\n2\nthree\n')
    expect(await run('edit_file', { path: 'src/a.ts', old_text: 'missing', new_text: 'x' })).toMatchObject({ isError: true })
    const tree = await run('list_files', { depth: 3 })
    expect(tree.content).toBe('new/\n  b.txt\nnode_modules/\nsrc/\n  a.ts')
    expect(await run('read_file', { path: 'nope.txt' })).toMatchObject({ isError: true })
  })

  it.skipIf(process.platform === 'win32')('runs commands with exit codes, timeouts and interrupts', async () => {
    const { tools, run } = setup()
    expect(await run('run_command', { command: 'echo hi && ls src' })).toEqual({ content: 'hi\na.ts\n[exit code 0]', isError: false })
    expect(await run('run_command', { command: 'exit 3' })).toMatchObject({ content: '(no output)\n[exit code 3]', isError: true })
    expect(await run('run_command', { command: 'sleep 5', timeout_seconds: 1 })).toMatchObject({
      content: expect.stringContaining('stopped after 1s'),
      isError: true
    })
    const controller = new AbortController()
    const pending = tools.run('run_command', { command: 'sleep 5' }, controller.signal)
    setTimeout(() => controller.abort(), 100)
    expect(await pending).toMatchObject({ content: expect.stringContaining('interrupted'), isError: true })
  })

  it('maps tools onto the permission engine', () => {
    expect(toEngineRequest('write_file', { path: 'a', content: 'x' }, 'win32')).toEqual({ name: 'Write', input: { file_path: 'a' } })
    expect(toEngineRequest('run_command', { command: 'ls' }, 'win32')).toEqual({ name: 'PowerShell', input: { command: 'ls' } })
    expect(toEngineRequest('run_command', { command: 'ls' }, 'linux').name).toBe('Bash')
    expect(toEngineRequest('mcp__gh__search', { q: 1 }, 'linux')).toEqual({ name: 'mcp__gh__search', input: { q: 1 } })
    expect(clip('x'.repeat(10), 4)).toBe('[… 6 characters cut]\nxxxx')
  })
})

/** Adapter double that replays one scripted reply per model call. */
function scriptedAdapter(replies: Array<Extract<AdapterEvent, { type: 'done' }> | Error>) {
  const calls: ChatMessage[][] = []
  const adapter: ChatAdapter = {
    async *stream(req) {
      calls.push(structuredClone(req.messages) as ChatMessage[])
      const reply = replies.shift()
      if (!reply) throw new Error('no more replies')
      if (reply instanceof Error) throw reply
      if (reply.text) yield { type: 'text_delta', text: reply.text }
      yield reply
    },
    listModels: async () => []
  }
  return { adapter, calls }
}

const done = (text: string, toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []) => ({
  type: 'done' as const,
  text,
  toolCalls,
  stopReason: toolCalls.length ? ('tool_use' as const) : ('end' as const),
  usage: { inputTokens: 10, outputTokens: 2 }
})

function loopHarness(level: 'validate-all' | 'autonomous', replies: Parameters<typeof scriptedAdapter>[0]) {
  const events: AgentEvent[] = []
  const broker = new ApprovalBroker((_id, event) => events.push(event))
  const { adapter, calls } = scriptedAdapter(replies)
  const execute = vi.fn(async () => ({ content: 'a.ts', isError: false }))
  const session = new ApiSession(
    { model: 'm', system: 'sys', tools: BASE_TOOLS },
    {
      adapter,
      emit: (e) => events.push(e),
      toEngine: (call) => toEngineRequest(call.name, call.input, 'linux'),
      decide: (tool) => decide({ level, cwd: '/repo', platform: 'linux' }, tool),
      ask: (q, signal) => broker.ask('s', q, signal),
      execute,
      describeError: (err) => `failed: ${(err as Error).message}`
    }
  )
  const running = session.start()
  const turnEnds = () => events.filter((e) => e.type === 'turn_end')
  const answer = async (decision: 'allow-once' | 'deny', message?: string) => {
    await vi.waitFor(() => expect(events.some((e) => e.type === 'approval_request')).toBe(true))
    const req = [...events].reverse().find((e) => e.type === 'approval_request')
    if (req?.type === 'approval_request') broker.answer('s', req.requestId, decision, message)
  }
  return { events, session, calls, execute, running, turnEnds, answer }
}

describe('ApiSession', () => {
  it('runs tools the engine allows and feeds results back', async () => {
    const h = loopHarness('autonomous', [done('Let me look.', [{ id: 'c1', name: 'list_files', input: {} }]), done('There is a.ts.')])
    h.session.send('what is here?')
    await vi.waitFor(() => expect(h.turnEnds()).toHaveLength(1))
    expect(h.events.map((e) => e.type)).toEqual([
      'init',
      'text_delta',
      'text',
      'tool_call',
      'tool_result',
      'text_delta',
      'text',
      'turn_end'
    ])
    expect(h.calls[1]?.at(-1)).toEqual({
      role: 'tool',
      results: [{ toolCallId: 'c1', name: 'list_files', content: 'a.ts', isError: false }]
    })
    expect(h.turnEnds()[0]).toMatchObject({ isError: false, costUsd: null, inputTokens: 20, outputTokens: 4 })
    h.session.stop()
    await h.running
  })

  it('asks before shell commands and returns denials to the model', async () => {
    const h = loopHarness('validate-all', [done('', [{ id: 'c1', name: 'run_command', input: { command: 'rm -rf build' } }]), done('OK.')])
    h.session.send('clean')
    await h.answer('deny', 'Use npm run clean')
    await vi.waitFor(() => expect(h.turnEnds()).toHaveLength(1))
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.calls[1]?.at(-1)).toMatchObject({
      role: 'tool',
      results: [{ content: 'The user denied this call: Use npm run clean', isError: true }]
    })
    h.session.stop()
  })

  it('refuses what the engine denies without asking', async () => {
    const h = loopHarness('autonomous', [done('', [{ id: 'c1', name: 'write_file', input: { path: '/etc/x', content: '' } }]), done('Sorry.')])
    h.session.send('go')
    await vi.waitFor(() => expect(h.turnEnds()).toHaveLength(1))
    expect(h.events.some((e) => e.type === 'permission_denied')).toBe(true)
    expect(h.events.some((e) => e.type === 'approval_request')).toBe(false)
    h.session.stop()
  })

  it('recovers from API errors and interrupts, keeping a valid history', async () => {
    const h = loopHarness('validate-all', [
      Object.assign(new Error('boom'), { status: 500 }),
      done('', [{ id: 'c1', name: 'run_command', input: { command: 'npm test' } }]),
      done('Back.')
    ])
    h.session.send('first')
    await vi.waitFor(() => expect(h.turnEnds()).toHaveLength(1))
    expect(h.turnEnds()[0]).toMatchObject({ isError: true, subtype: 'error_during_execution', errors: ['failed: boom'] })

    h.session.send('second')
    await vi.waitFor(() => expect(h.events.some((e) => e.type === 'approval_request')).toBe(true))
    await h.session.interrupt()
    await vi.waitFor(() => expect(h.turnEnds()).toHaveLength(2))
    expect(h.turnEnds()[1]).toMatchObject({ subtype: 'interrupted' })
    expect(h.events.filter((e) => e.type === 'tool_result').at(-1)).toMatchObject({ toolUseId: 'c1', isError: true })

    h.session.send('third')
    await vi.waitFor(() => expect(h.turnEnds()).toHaveLength(3))
    // The interrupted call has a result, so the provider accepts the history.
    const third = h.calls.at(-1) ?? []
    expect(third.map((m) => m.role)).toEqual(['user', 'user', 'assistant', 'tool', 'user'])
    h.session.stop()
  })
})
