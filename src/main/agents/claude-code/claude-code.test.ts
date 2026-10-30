import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@shared/agent'
import { ApprovalBroker } from '../../permissions/broker'
import { decide } from '../../permissions/engine'
import { ClaudeCodeSession, checkApiKey, testConnection } from './provider'
import { binaryPackages, buildProfileEnv, parseAuthStatus } from './runtime'
import { MessageTranslator, toolResultText } from './translate'
import { fakeQuery, sdk } from './fake-query'

describe('buildProfileEnv', () => {
  it('drops inherited accounts and sets the profile config dir', () => {
    const env = buildProfileEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/me',
        ANTHROPIC_API_KEY: 'sk-ant-other',
        ANTHROPIC_BASE_URL: 'https://proxy',
        CLAUDE_CODE_OAUTH_TOKEN: 'tok',
        CLAUDE_CONFIG_DIR: '/home/me/.claude',
        CLAUDECODE: '1',
        CLAUDE_CODE_USE_BEDROCK: '1',
        CODEX_HOME: '/home/me/.codex',
        GEMINI_API_KEY: 'AIza-other',
        GOOGLE_APPLICATION_CREDENTIALS: '/home/me/adc.json',
        AGY_ADC_AUTH: 'true',
        GOOGLE_CHROME_BIN: '/usr/bin/chrome'
      },
      { configDir: '/data/claude-profiles/p1', apiKey: null },
      'atelier/0.1.0'
    )
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      GOOGLE_CHROME_BIN: '/usr/bin/chrome',
      CLAUDE_CONFIG_DIR: '/data/claude-profiles/p1',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'atelier/0.1.0'
    })
  })

  it('passes the profile key, and only that key', () => {
    const env = buildProfileEnv({ ANTHROPIC_API_KEY: 'sk-ant-other' }, { configDir: '/p', apiKey: 'sk-ant-mine' }, 'a')
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-mine')
  })
})

describe('runtime helpers', () => {
  it('names the platform packages of the bundled binary', () => {
    expect(binaryPackages('win32', 'x64')).toEqual(['@anthropic-ai/claude-agent-sdk-win32-x64'])
    expect(binaryPackages('linux', 'arm64')).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-arm64',
      '@anthropic-ai/claude-agent-sdk-linux-arm64-musl'
    ])
  })

  it('parses auth status output', () => {
    expect(parseAuthStatus('{"loggedIn":false,"authMethod":"none"}')).toMatchObject({ loggedIn: false, email: null })
    expect(parseAuthStatus('{"loggedIn":true,"email":"me@x.io","subscriptionType":"max"}')).toMatchObject({
      loggedIn: true,
      email: 'me@x.io',
      subscriptionType: 'max'
    })
    expect(() => parseAuthStatus('not json')).toThrow()
  })
})

describe('MessageTranslator', () => {
  it('keys streamed text and the complete text the same way, even when messages are split per block', () => {
    const t = new MessageTranslator()
    const events = [
      sdk.init(),
      sdk.stream({ type: 'message_start', message: { id: 'm1' } }),
      sdk.stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sdk.stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
      sdk.stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }),
      sdk.stream({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'Bash' } }),
      sdk.stream({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{' } }),
      sdk.stream({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } }),
      sdk.stream({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Done' } }),
      // Claude Code sends one assistant message per block, all with the same id.
      sdk.assistant('m1', [{ type: 'text', text: 'Hello' }]),
      sdk.assistant('m1', [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }]),
      sdk.assistant('m1', [{ type: 'text', text: 'Done.' }]),
      sdk.toolResult('tu1', [{ type: 'text', text: 'a.ts' }]),
      sdk.result()
    ].flatMap((m) => t.translate(m))

    expect(events).toEqual([
      { type: 'init', model: 'claude-sonnet-5', cliVersion: '2.1.312', cwd: '/repo', tools: ['Bash', 'Read'] },
      { type: 'text_delta', key: 'm1:0', text: 'Hel' },
      { type: 'text_delta', key: 'm1:0', text: 'lo' },
      { type: 'text_delta', key: 'm1:1', text: 'Done' },
      { type: 'text', key: 'm1:0', text: 'Hello' },
      { type: 'tool_call', toolUseId: 'tu1', name: 'Bash', input: { command: 'ls' }, parentToolUseId: null },
      { type: 'text', key: 'm1:1', text: 'Done.' },
      { type: 'tool_result', toolUseId: 'tu1', content: 'a.ts', isError: false },
      {
        type: 'turn_end',
        isError: false,
        subtype: 'success',
        errors: [],
        costUsd: 0.0123,
        inputTokens: 1100,
        cacheReadTokens: 1000,
        cacheWriteTokens: 0,
        contextTokens: null,
        contextWindow: null,
        outputTokens: 50,
        durationMs: 1500
      }
    ])
  })

  it('reports assistant errors and rate limits, and hides subagent text', () => {
    const t = new MessageTranslator()
    const events = [
      sdk.assistant('m2', [{ type: 'text', text: 'Invalid API key' }], { error: 'authentication_failed' }),
      { ...sdk.assistant('m3', [{ type: 'text', text: 'subagent says hi' }]), parent_tool_use_id: 'tu9' },
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed_warning', resetsAt: 1700000000, utilization: 0.9, rateLimitType: 'five_hour' }
      }
    ].flatMap((m) => t.translate(m as never))
    expect(events[0]).toMatchObject({ type: 'text', text: 'Invalid API key' })
    expect(events[1]).toMatchObject({ type: 'error', message: expect.stringMatching(/not signed in/) })
    expect(events[2]).toEqual({
      type: 'rate_limit',
      status: 'allowed_warning',
      resetsAt: 1700000000,
      utilization: 0.9,
      limitType: 'five_hour'
    })
    expect(events).toHaveLength(3)
  })

  it('turns the running session cost into a cost per turn', () => {
    const t = new MessageTranslator()
    const costs = [0.02, 0.05, 0.05].map((total) => {
      const [event] = t.translate(sdk.result({ total_cost_usd: total }))
      return event?.type === 'turn_end' ? event.costUsd : undefined
    })
    expect(costs[0]).toBeCloseTo(0.02)
    expect(costs[1]).toBeCloseTo(0.03)
    expect(costs[2]).toBe(0)
  })

  it('flattens and truncates tool results', () => {
    expect(toolResultText('plain')).toBe('plain')
    expect(toolResultText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\n[image]\nb')
    expect(toolResultText('x'.repeat(30_000))).toMatch(/\[truncated\]$/)
  })
})

function sessionHarness(level: 'validate-all' | 'files-auto' | 'autonomous', script: Parameters<typeof fakeQuery>[0]) {
  const events: AgentEvent[] = []
  const broker = new ApprovalBroker((_id, event) => events.push(event))
  const { query, calls } = fakeQuery(script)
  const session = new ClaudeCodeSession(
    { binary: '/bin/claude', env: { CLAUDE_CONFIG_DIR: '/p' }, cwd: '/repo', model: 'opus' },
    {
      query,
      emit: (event) => events.push(event),
      decide: (tool) => decide({ level, cwd: '/repo', platform: 'linux' }, tool),
      ask: (question, signal) => broker.ask('s1', question, signal)
    }
  )
  const approve = async (decision: 'allow-once' | 'deny', message?: string) => {
    await vi.waitFor(() => expect(events.some((e) => e.type === 'approval_request')).toBe(true))
    const req = events.find((e) => e.type === 'approval_request')
    if (req?.type !== 'approval_request') throw new Error('no request')
    broker.answer('s1', req.requestId, decision, message)
  }
  return { events, session, calls, approve }
}

describe('ClaudeCodeSession', () => {
  it('starts Claude Code with the profile, hooks and permission mode', async () => {
    const { session, calls } = sessionHarness('validate-all', async function* () {
      yield sdk.init()
    })
    await session.start()
    const opts = calls[0] ?? {}
    expect(opts).toMatchObject({
      cwd: '/repo',
      env: { CLAUDE_CONFIG_DIR: '/p' },
      pathToClaudeCodeExecutable: '/bin/claude',
      model: 'opus',
      permissionMode: 'default',
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      systemPrompt: { type: 'preset', preset: 'claude_code' }
    })
    expect(opts.hooks?.PreToolUse?.[0]?.timeout).toBeGreaterThan(3600)
    expect(opts.canUseTool).toBeTypeOf('function')
  })

  it('asks before a shell command and lets it run once approved', async () => {
    let hookResult: unknown
    const { events, session, approve } = sessionHarness('validate-all', async function* (ctx) {
      const prompt = await ctx.nextUser()
      expect(prompt?.message.content).toBe('run the tests')
      yield sdk.assistant('m1', [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } }])
      hookResult = await ctx.preToolUse('Bash', { command: 'npm test' }, 'tu1')
      // Claude Code may still consult canUseTool for the call the user just approved.
      const canUseTool = ctx.options.canUseTool
      if (!canUseTool) throw new Error('no canUseTool')
      const again = await canUseTool('Bash', { command: 'npm test' }, {
        signal: new AbortController().signal,
        toolUseID: 'tu1'
      } as never)
      expect(again).toMatchObject({ behavior: 'allow' })
      yield sdk.toolResult('tu1', 'ok')
      yield sdk.result()
    })
    const done = session.start()
    session.send('run the tests')
    await approve('allow-once')
    await done
    expect(hookResult).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } })
    expect(events.filter((e) => e.type === 'approval_request')).toHaveLength(1)
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'approval_request', 'approval_resolved', 'tool_result', 'turn_end'])
  })

  it('returns the denial message to Claude', async () => {
    let hookResult: unknown
    const { session, approve } = sessionHarness('files-auto', async function* (ctx) {
      await ctx.nextUser()
      hookResult = await ctx.preToolUse('Bash', { command: 'rm -rf build' }, 'tu1')
      yield sdk.result()
    })
    const done = session.start()
    session.send('clean up')
    await approve('deny', 'Use npm run clean')
    await done
    expect(hookResult).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'Use npm run clean' }
    })
  })

  it('decides without asking when the engine allows or denies', async () => {
    const results: unknown[] = []
    const { events, session } = sessionHarness('autonomous', async function* (ctx) {
      await ctx.nextUser()
      results.push(await ctx.preToolUse('Edit', { file_path: '/repo/a.ts' }, 'tu1'))
      results.push(await ctx.preToolUse('Bash', { command: 'git push' }, 'tu2'))
      yield sdk.result()
    })
    const done = session.start()
    session.send('go')
    await done
    expect(results).toMatchObject([
      { hookSpecificOutput: { permissionDecision: 'allow' } },
      { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: expect.stringMatching(/git push/) } }
    ])
    expect(events.some((e) => e.type === 'approval_request')).toBe(false)
  })

  it('reports a crash of the Claude Code process', async () => {
    const { events, session } = sessionHarness('validate-all', async function* () {
      yield sdk.init()
      throw new Error('Claude Code process exited with code 1')
    })
    await expect(session.start()).rejects.toThrow(/exited/)
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Claude Code process exited with code 1' })
  })
})

describe('testConnection', () => {
  const target = { binary: '/bin/claude', env: {}, cwd: '/p' }
  const signedIn = async () => ({
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    email: null,
    orgName: null,
    subscriptionType: null
  })

  it('reports a signed-out subscription profile without starting a session', async () => {
    const { query, calls } = fakeQuery(async function* () {})
    const result = await testConnection(
      {
        query: async () => query,
        fetch: vi.fn(),
        authStatus: async () => ({ ...(await signedIn()), loggedIn: false })
      },
      { ...target, apiKey: null }
    )
    expect(result).toMatchObject({ ok: false, status: 'Not signed in' })
    expect(calls).toHaveLength(0)
  })

  it('lists models and account details when signed in', async () => {
    const { query } = fakeQuery(async function* () {})
    const result = await testConnection({ query: async () => query, fetch: vi.fn(), authStatus: signedIn }, { ...target, apiKey: null })
    expect(result).toMatchObject({ ok: true, status: 'Signed in', email: 'me@example.com', subscriptionType: 'Pro' })
    expect(result.models.map((m) => m.value)).toEqual(['default', 'opus'])
  })

  it('checks API keys against the API', async () => {
    const { query } = fakeQuery(async function* () {})
    const fetch = vi.fn(async () => ({ status: 401 }))
    const result = await testConnection({ query: async () => query, fetch, authStatus: signedIn }, { ...target, apiKey: 'sk-ant-x' })
    expect(result).toMatchObject({ ok: false, status: 'Key rejected' })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('api.anthropic.com/v1/models'), {
      headers: { 'x-api-key': 'sk-ant-x', 'anthropic-version': '2023-06-01' }
    })
  })

  it('explains network failures', async () => {
    const result = await checkApiKey(async () => {
      throw new Error('ECONNREFUSED')
    }, 'k')
    expect(result).toEqual({ ok: false, detail: 'Could not reach the Anthropic API: ECONNREFUSED' })
  })
})
