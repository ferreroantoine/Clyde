import { describe, expect, it, vi } from 'vitest'
import { findModel, type ModelOption } from '@shared/profiles'
import { agyArgs } from './antigravity/runtime'
import { codexModelOption } from './codex/runtime'
import { anthropicEfforts, AnthropicAdapter } from './api/anthropic'
import { compatEfforts, ollamaEfforts, OpenAICompatAdapter } from './api/openai-compat'
import { ClaudeCodeSession } from './claude-code/provider'
import { fakeQuery } from './claude-code/fake-query'

describe('reasoning effort', () => {
  it('reaches agy as --effort, only with a level agy knows', () => {
    expect(agyArgs('hi', { model: 'm', effort: 'high', conversationId: null })).toEqual(['-p', 'hi', '--output-format', 'stream-json', '--model', 'm', '--effort', 'high'])
    expect(agyArgs('hi', { model: '', effort: 'minimal', conversationId: null })).not.toContain('--effort')
  })

  it('reads the levels each Codex model advertises', () => {
    expect(
      codexModelOption({
        id: 'x',
        model: 'gpt-6',
        displayName: 'GPT-6',
        description: 'd',
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: '' },
          { reasoningEffort: 'high', description: '' },
          { reasoningEffort: 'turbo', description: '' }
        ],
        defaultReasoningEffort: 'high'
      })
    ).toEqual({ value: 'gpt-6', displayName: 'GPT-6', description: 'd', efforts: ['low', 'high'], defaultEffort: 'high', isDefault: true })
  })

  it('reads Anthropic model capabilities, and guesses the others by name', () => {
    const yes = { supported: true }
    const no = { supported: false }
    expect(anthropicEfforts({ supported: true, low: yes, medium: yes, high: yes, xhigh: null, max: no })).toEqual(['low', 'medium', 'high'])
    expect(anthropicEfforts(null)).toEqual([])
    expect(compatEfforts('openai', 'gpt-5.2')).toEqual(['low', 'medium', 'high'])
    expect(compatEfforts('openai', 'gpt-5-chat-latest')).toEqual([])
    expect(compatEfforts('openai', 'gpt-4.1')).toEqual([])
    expect(compatEfforts('gemini', 'gemini-2.5-flash')).toEqual(['low', 'medium', 'high'])
    expect(compatEfforts('gemini', 'gemini-2.0-flash')).toEqual([])
    expect(ollamaEfforts('gpt-oss:20b', ['completion', 'tools', 'thinking'])).toEqual(['low', 'medium', 'high'])
    expect(ollamaEfforts('qwen3:8b', ['completion', 'thinking'])).toEqual(['none', 'high'])
    expect(ollamaEfforts('llama3.2', ['completion'])).toEqual([])
  })

  it('finds the default model when none is chosen', () => {
    const models: ModelOption[] = [
      { value: 'a', displayName: 'A', description: '' },
      { value: 'b', displayName: 'B', description: '', isDefault: true, efforts: ['low'] }
    ]
    expect(findModel(models, '')?.value).toBe('b')
    expect(findModel(models, 'a')?.value).toBe('a')
    expect(findModel(models, 'zzz')).toBeUndefined()
  })

  it('sends the effort in API requests', async () => {
    const create = vi.fn(async () => {
      throw new Error('stop here')
    })
    const openai = new OpenAICompatAdapter({ chat: { completions: { create } } } as never, 'openai')
    const req = { model: 'gpt-5', system: 's', messages: [], tools: [], signal: new AbortController().signal, effort: 'high' as const }
    await expect(openai.stream(req).next()).rejects.toThrow('stop here')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ reasoning_effort: 'high' }), expect.anything())

    const messages = vi.fn(async () => {
      throw new Error('stop here')
    })
    const anthropic = new AnthropicAdapter({ messages: { create: messages } } as never)
    await expect(anthropic.stream({ ...req, model: 'claude-opus-5-5' }).next()).rejects.toThrow('stop here')
    expect(messages).toHaveBeenCalledWith(expect.objectContaining({ output_config: { effort: 'high' } }), expect.anything())
    messages.mockClear()
    // A level Claude does not have is not sent.
    await expect(anthropic.stream({ ...req, effort: 'minimal' }).next()).rejects.toThrow('stop here')
    expect((messages.mock.calls as unknown as unknown[][])[0]?.[0]).not.toHaveProperty('output_config')
  })

  it('passes the effort to Claude Code', async () => {
    const { query, calls } = fakeQuery(async function* () {})
    const session = new ClaudeCodeSession(
      { binary: '/bin/claude', env: {}, cwd: '/repo', model: 'opus', effort: 'xhigh' },
      { query, emit: () => undefined, decide: () => ({ decision: 'allow' }) as never, ask: async () => ({ behavior: 'allow' }) as never }
    )
    await session.start()
    expect(calls[0]).toMatchObject({ effort: 'xhigh' })
  })
})
