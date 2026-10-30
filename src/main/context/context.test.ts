import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@shared/agent'
import type { AdapterEvent, ChatAdapter, ChatMessage } from '../agents/api/chat'
import { ApiSession } from '../agents/api/loop'
import { withCacheBreakpoints, toAnthropicMessages } from '../agents/api/anthropic'
import { breakdown, compactToolResults, historyFromEvents, splitForSummary, transcriptText, withSummary, READ_TOOL_OUTPUT } from './history'

const big = (n: number, c = 'x') => c.repeat(n)

const turn = (q: string, a: string): ChatMessage[] => [
  { role: 'user', text: q },
  { role: 'assistant', text: a, toolCalls: [] }
]

describe('compactToolResults', () => {
  it('shortens large results the model already read, keeps the last tool message whole', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'read both' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'a', name: 'read_file', input: {} }] },
      { role: 'tool', results: [{ toolCallId: 'a', name: 'read_file', content: big(10_000, 'a'), isError: false }] },
      { role: 'assistant', text: '', toolCalls: [{ id: 'b', name: 'read_file', input: {} }] },
      { role: 'tool', results: [{ toolCallId: 'b', name: 'read_file', content: big(10_000, 'b'), isError: false }] }
    ]
    const { history: out, cut } = compactToolResults(history, 4_000)
    const first = out[2]?.role === 'tool' ? out[2].results[0]?.content ?? '' : ''
    expect(first.length).toBeLessThan(4_000)
    expect(first.startsWith(big(1_500, 'a'))).toBe(true)
    expect(first.endsWith(big(1_500, 'a'))).toBe(true)
    expect(first).toContain(`call ${READ_TOOL_OUTPUT} with id "a"`)
    expect(out[4]).toBe(history[4])
    expect(cut.get('a')).toBe(big(10_000, 'a'))
    // Small results and already-shortened ones stay as they are.
    expect(compactToolResults(out, 4_000).cut.size).toBe(0)
    expect(history[2]).not.toBe(out[2])
  })
})

describe('rolling summary', () => {
  it('summarizes everything but the last turns, cutting at a turn boundary', () => {
    const history: ChatMessage[] = [
      ...turn('one', 'uno'),
      { role: 'user', text: 'two' },
      { role: 'assistant', text: '', toolCalls: [{ id: 't', name: 'list_files', input: {} }] },
      { role: 'tool', results: [{ toolCallId: 't', name: 'list_files', content: 'a.ts', isError: false }] },
      { role: 'assistant', text: 'dos', toolCalls: [] },
      ...turn('three', 'tres')
    ]
    const split = splitForSummary(history, 2)
    expect(split?.older).toEqual(turn('one', 'uno'))
    expect(split?.recent[0]).toEqual({ role: 'user', text: 'two' })
    expect(split?.recent).toHaveLength(6)
    expect(splitForSummary(turn('only', 'one'), 2)).toBeNull()
    const next = withSummary('- talked about numbers', split?.recent ?? [])
    expect(next[0]).toMatchObject({ role: 'user', text: expect.stringContaining('- talked about numbers') })
    expect(next[1]?.role).toBe('assistant')
    expect(next.slice(2)).toEqual(split?.recent)
    expect(transcriptText(history.slice(0, 5))).toContain('Tool list_files: a.ts')
  })

  it('replaces old turns when the history passes the threshold', async () => {
    const requests: ChatMessage[][] = []
    const adapter: ChatAdapter = {
      async *stream(req) {
        requests.push(structuredClone(req.messages) as ChatMessage[])
        yield { type: 'done', text: big(2_000, 'r'), toolCalls: [], stopReason: 'end', usage: { inputTokens: 100, outputTokens: 10 } } satisfies AdapterEvent
      },
      listModels: async () => []
    }
    const events: AgentEvent[] = []
    const summarize = vi.fn(async (text: string) => `summary of ${text.length} chars`)
    const session = new ApiSession(
      { model: 'm', system: 'sys', tools: [], summarizeAt: 1_000, keepTurns: 1 },
      {
        adapter,
        emit: (e) => events.push(e),
        toEngine: () => ({ name: 'x', input: {} }),
        decide: () => ({ decision: 'allow' }),
        ask: async () => ({ behavior: 'allow' }),
        execute: async () => ({ content: '', isError: false }),
        describeError: String,
        summarize
      }
    )
    void session.start()
    const ends = () => events.filter((e) => e.type === 'turn_end').length
    session.send('first')
    await vi.waitFor(() => expect(ends()).toBe(1))
    session.send('second')
    await vi.waitFor(() => expect(ends()).toBe(2))
    session.send('third')
    await vi.waitFor(() => expect(ends()).toBe(3))
    expect(summarize).toHaveBeenCalled()
    const lastRequest = requests.at(-1) ?? []
    expect(lastRequest[0]).toMatchObject({ role: 'user', text: expect.stringContaining('summary of') })
    expect(lastRequest.at(-1)).toEqual({ role: 'user', text: 'third' })
    expect(events.some((e) => e.type === 'context_summarized')).toBe(true)
    session.stop()
  })
})

describe('read_tool_output and breakdown', () => {
  it('lets the model read back a shortened output without asking for permission', async () => {
    const replies: AdapterEvent[] = [
      { type: 'done', text: '', toolCalls: [{ id: 'r1', name: 'read_file', input: { path: 'a' } }], stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 1 } },
      { type: 'done', text: '', toolCalls: [{ id: 'r2', name: 'read_file', input: { path: 'b' } }], stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 1 } },
      { type: 'done', text: '', toolCalls: [{ id: 'r3', name: READ_TOOL_OUTPUT, input: { id: 'r1', offset: 9_990 } }], stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 1 } },
      { type: 'done', text: 'done', toolCalls: [], stopReason: 'end', usage: { inputTokens: 40, outputTokens: 5, cacheReadTokens: 30 } }
    ]
    const adapter: ChatAdapter = {
      async *stream() {
        yield replies.shift() as AdapterEvent
      },
      listModels: async () => []
    }
    const events: AgentEvent[] = []
    const decide = vi.fn(() => ({ decision: 'allow' as const }))
    const session = new ApiSession(
      { model: 'm', system: 'sys', memory: 'mem', tools: [] },
      {
        adapter,
        emit: (e) => events.push(e),
        toEngine: (call) => ({ name: call.name, input: call.input }),
        decide,
        ask: async () => ({ behavior: 'allow' }),
        execute: async (call) => ({ content: big(10_000, call.input['path'] as string), isError: false }),
        describeError: String
      }
    )
    void session.start()
    session.send('go')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'turn_end')).toBe(true))
    const readBack = events.find((e) => e.type === 'tool_result' && e.toolUseId === 'r3')
    expect(readBack).toMatchObject({ content: 'aaaaaaaaaa', isError: false })
    expect(decide).toHaveBeenCalledTimes(2)
    const end = events.find((e) => e.type === 'turn_end')
    expect(end).toMatchObject({ cacheReadTokens: 30, contextTokens: 45 })
    if (end?.type === 'turn_end') {
      const b = end.breakdown
      expect(b && b.system + b.memory + b.tools + b.history + b.toolResults).toBeGreaterThanOrEqual(39)
      expect(b?.output).toBe(5)
      expect(b?.toolResults).toBeGreaterThan(b?.history ?? 0)
    }
    session.stop()
  })

  it('splits the reported input by part sizes', () => {
    const b = breakdown({ system: big(400), memory: big(400), tools: [], history: [{ role: 'user', text: big(150) }] }, 1_000, 50)
    expect(b.system).toBeGreaterThan(300)
    expect(b.memory).toBe(b.system)
    expect(b.output).toBe(50)
  })

  it('puts Anthropic cache breakpoints after the system prompt and on the last block', () => {
    const { system, messages } = withCacheBreakpoints('sys', toAnthropicMessages([{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b', toolCalls: [] }, { role: 'user', text: 'c' }]))
    expect(system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }])
    const last = messages.at(-1)?.content
    expect(Array.isArray(last) && last.at(-1)).toMatchObject({ text: 'c', cache_control: { type: 'ephemeral' } })
    const first = messages[0]?.content
    expect(Array.isArray(first) && 'cache_control' in (first[0] as object)).toBe(false)
  })
})

describe('historyFromEvents', () => {
  it('rebuilds the conversation of a stored session, cut calls included', () => {
    const events: AgentEvent[] = [
      { type: 'user', id: 'u1', text: 'read a' },
      { type: 'text', key: 't1s0:0', text: 'Reading.' },
      { type: 'tool_call', toolUseId: 'c1', name: 'read_file', input: { path: 'a' }, parentToolUseId: null },
      { type: 'tool_result', toolUseId: 'c1', content: 'A', isError: false },
      { type: 'text', key: 't1s1:0', text: 'It says A.' },
      { type: 'turn_end', isError: false, subtype: 'success', errors: [], costUsd: null, inputTokens: 1, outputTokens: 1, durationMs: 1 },
      { type: 'user', id: 'u2', text: 'now b' },
      { type: 'tool_call', toolUseId: 'c2', name: 'read_file', input: { path: 'b' }, parentToolUseId: null }
    ]
    expect(historyFromEvents(events)).toEqual([
      { role: 'user', text: 'read a' },
      { role: 'assistant', text: 'Reading.', toolCalls: [{ id: 'c1', name: 'read_file', input: { path: 'a' } }] },
      { role: 'tool', results: [{ toolCallId: 'c1', name: 'read_file', content: 'A', isError: false }] },
      { role: 'assistant', text: 'It says A.', toolCalls: [] },
      { role: 'user', text: 'now b' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'c2', name: 'read_file', input: { path: 'b' } }] },
      { role: 'tool', results: [{ toolCallId: 'c2', name: 'read_file', content: 'No result: the session was interrupted.', isError: true }] }
    ])
  })
})
