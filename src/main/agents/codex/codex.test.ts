import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@shared/agent'
import { decide } from '../../permissions/engine'
import type { ApprovalOutcome, ApprovalQuestion } from '../../permissions/broker'
import type { CliProcess, SpawnOptions } from '../cli/process'
import { lineSplitter, RpcConnection, type RpcTransport } from './rpc'
import { CodexTranslator, describeCodexError, versionFromUserAgent } from './translate'
import { codexPolicy, CodexSession } from './session'
import { buildCodexEnv, codexMcpServers, probeCodex, testCodexConnection } from './runtime'

type Msg = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown }

/** An in-memory `codex app-server`: scripted answers to requests, and a way to push messages. */
class FakeCodex implements CliProcess {
  readonly received: Msg[] = []
  private lineListeners: Array<(line: string) => void> = []
  private closeListeners: Array<(reason: Error | null) => void> = []
  private resolveExit: (code: number | null) => void = () => undefined
  readonly exited = new Promise<number | null>((r) => (this.resolveExit = r))
  killed = false
  spawned: SpawnOptions | null = null

  constructor(private readonly answer: (msg: Msg, fake: FakeCodex) => unknown) {}

  readonly transport: RpcTransport = {
    write: (line) => {
      const msg = JSON.parse(line) as Msg
      this.received.push(msg)
      if (msg.id !== undefined && msg.method) {
        const result = this.answer(msg, this)
        if (result instanceof Error) this.push({ id: msg.id, error: { code: -32600, message: result.message } })
        else if (result !== undefined) this.push({ id: msg.id, result })
      }
    },
    onLine: (l) => this.lineListeners.push(l),
    onClose: (l) => this.closeListeners.push(l)
  }

  push(msg: Msg): void {
    queueMicrotask(() => this.lineListeners.forEach((l) => l(JSON.stringify(msg))))
  }

  notify(method: string, params: unknown): void {
    this.push({ method, params })
  }

  /** Sends a server request and resolves with the client's answer. */
  ask(id: number, method: string, params: unknown): Promise<Msg> {
    this.push({ id, method, params })
    return vi.waitFor(() => {
      const reply = this.received.find((m) => m.id === id && m.method === undefined)
      if (!reply) throw new Error('no reply yet')
      return reply
    })
  }

  requests(method: string): Msg[] {
    return this.received.filter((m) => m.method === method)
  }

  stderrTail(): string {
    return ''
  }

  kill(): void {
    this.killed = true
    this.exit(null)
  }

  exit(code: number | null): void {
    this.closeListeners.forEach((l) => l(null))
    this.resolveExit(code)
  }
}

const INIT = { userAgent: 'atelier/0.165.0 (Windows 11; x86_64) windows (atelier; 0.1.0)', codexHome: 'C:\\h', platformFamily: 'windows', platformOs: 'windows' }
const THREAD = { thread: { id: 'th-1' }, model: 'gpt-6.1-sol', cwd: '/repo' }

function standardAnswers(msg: Msg): unknown {
  switch (msg.method) {
    case 'initialize':
      return INIT
    case 'thread/start':
      return THREAD
    case 'turn/start':
      return { turn: { id: 'turn-1', status: 'inProgress', error: null, durationMs: null } }
    case 'turn/interrupt':
    case 'turn/steer':
      return {}
    default:
      return undefined
  }
}

function session(level: 'validate-all' | 'files-auto' | 'autonomous' = 'validate-all', ask?: (q: ApprovalQuestion) => ApprovalOutcome) {
  const fake = new FakeCodex(standardAnswers)
  const events: AgentEvent[] = []
  const questions: ApprovalQuestion[] = []
  const s = new CodexSession(
    {
      binary: '/bin/codex',
      env: { CODEX_HOME: '/h' },
      cwd: '/repo',
      model: '',
      permissionLevel: level,
      platform: 'linux',
      instructions: 'Be brief.',
      mcpServers: {},
      clientVersion: '0.1.0'
    },
    {
      spawn: (opts) => {
        fake.spawned = opts
        return fake
      },
      emit: (e) => events.push(e),
      decide: (tool) => decide({ level, cwd: '/repo', platform: 'linux' }, tool),
      ask: async (q) => {
        questions.push(q)
        return ask ? ask(q) : { behavior: 'allow' }
      }
    }
  )
  const done = s.start()
  return { fake, events, questions, s, done }
}

describe('RpcConnection', () => {
  it('matches responses to requests, answers server requests and reports errors', async () => {
    const sent: string[] = []
    let deliver: (line: string) => void = () => undefined
    const rpc = new RpcConnection({ write: (l) => sent.push(l), onLine: (l) => (deliver = l), onClose: () => undefined })
    rpc.onRequest(async (method) => {
      if (method === 'boom') throw new Error('no')
      return { ok: method }
    })
    const a = rpc.request('a', { x: 1 })
    const b = rpc.request('b')
    expect(sent.map((l) => JSON.parse(l))).toEqual([{ id: 1, method: 'a', params: { x: 1 } }, { id: 2, method: 'b' }])
    deliver('{"id":2,"result":"B"}')
    deliver('{"id":1,"error":{"code":-32600,"message":"bad"}}')
    await expect(b).resolves.toBe('B')
    await expect(a).rejects.toThrow('bad')
    deliver('{"id":"s1","method":"hello","params":{}}')
    deliver('{"id":"s2","method":"boom"}')
    deliver('not json')
    await vi.waitFor(() => expect(sent.length).toBe(4))
    expect(JSON.parse(sent[2] as string)).toEqual({ id: 's1', result: { ok: 'hello' } })
    expect(JSON.parse(sent[3] as string)).toMatchObject({ id: 's2', error: { message: 'no' } })
  })

  it('fails pending requests when the process goes away', async () => {
    let close: (e: Error | null) => void = () => undefined
    const rpc = new RpcConnection({ write: () => undefined, onLine: () => undefined, onClose: (l) => (close = l) })
    const pending = rpc.request('x')
    close(null)
    await expect(pending).rejects.toThrow(/exited/)
    await expect(rpc.request('y')).rejects.toThrow(/exited/)
  })

  it('splits lines across chunks, including a multi-byte character cut in two', () => {
    const lines: string[] = []
    const feed = lineSplitter((l) => lines.push(l))
    const bytes = Buffer.from('{"t":"é"}\r\n{"b":1}\n')
    feed(bytes.subarray(0, 7))
    feed(bytes.subarray(7))
    expect(lines).toEqual(['{"t":"é"}', '{"b":1}'])
  })
})

describe('CodexTranslator', () => {
  it('maps messages, commands, file changes and MCP calls to panel events', () => {
    const t = new CodexTranslator('win32')
    const out = [
      ...t.translate('turn/started', { threadId: 'th', turn: { id: 'u', status: 'inProgress', error: null, durationMs: null } }),
      ...t.translate('item/agentMessage/delta', { threadId: 'th', turnId: 'u', itemId: 'm1', delta: 'Hel' }),
      ...t.translate('item/completed', { threadId: 'th', turnId: 'u', item: { type: 'agentMessage', id: 'm1', text: 'Hello' } }),
      ...t.translate('item/started', {
        threadId: 'th',
        turnId: 'u',
        item: { type: 'commandExecution', id: 'c1', command: 'dir', cwd: 'C:\\r', status: 'inProgress', aggregatedOutput: null, exitCode: null }
      }),
      ...t.translate('item/completed', {
        threadId: 'th',
        turnId: 'u',
        item: { type: 'commandExecution', id: 'c1', command: 'dir', cwd: 'C:\\r', status: 'failed', aggregatedOutput: 'nope', exitCode: 1 }
      }),
      ...t.translate('item/started', {
        threadId: 'th',
        turnId: 'u',
        item: { type: 'fileChange', id: 'f1', status: 'inProgress', changes: [{ path: 'a.ts', kind: { type: 'update', move_path: null }, diff: '+x' }] }
      }),
      ...t.translate('item/started', {
        threadId: 'th',
        turnId: 'u',
        item: { type: 'mcpToolCall', id: 'mc', server: 'gh', tool: 'list', status: 'inProgress', arguments: { q: 1 }, result: null, error: null }
      }),
      ...t.translate('item/completed', {
        threadId: 'th',
        turnId: 'u',
        item: {
          type: 'mcpToolCall',
          id: 'mc',
          server: 'gh',
          tool: 'list',
          status: 'completed',
          arguments: {},
          result: { content: [{ type: 'text', text: 'ok' }] },
          error: null
        }
      }),
      ...t.translate('item/started', { threadId: 'th', turnId: 'u', item: { type: 'reasoning', id: 'r' } })
    ]
    expect(out).toEqual([
      { type: 'text_delta', key: 'm1', text: 'Hel' },
      { type: 'text', key: 'm1', text: 'Hello' },
      { type: 'tool_call', toolUseId: 'c1', name: 'PowerShell', input: { command: 'dir', cwd: 'C:\\r' }, parentToolUseId: null },
      { type: 'tool_result', toolUseId: 'c1', content: 'nope\n[exit code 1]', isError: true },
      {
        type: 'tool_call',
        toolUseId: 'f1',
        name: 'Edit',
        input: { file_path: 'a.ts', changes: [{ path: 'a.ts', kind: 'update', diff: '+x' }] },
        parentToolUseId: null
      },
      { type: 'tool_call', toolUseId: 'mc', name: 'mcp__gh__list', input: { q: 1 }, parentToolUseId: null },
      { type: 'tool_result', toolUseId: 'mc', content: 'ok', isError: false }
    ])
    expect(t.changesOf('f1').map((c) => c.path)).toEqual(['a.ts'])
  })

  it('reports each turn’s own tokens from the thread totals', () => {
    const t = new CodexTranslator('linux')
    const usage = (input: number, output: number) => ({
      threadId: 'th',
      turnId: 'u',
      tokenUsage: {
        total: { totalTokens: input + output, inputTokens: input, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: output, reasoningOutputTokens: 0 },
        last: { totalTokens: 0, inputTokens: input, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: output, reasoningOutputTokens: 0 },
        modelContextWindow: 272_000
      }
    })
    const turn = (id: string) => ({ threadId: 'th', turn: { id, status: 'completed' as const, error: null, durationMs: 1200 } })
    t.translate('turn/started', turn('1'))
    t.translate('thread/tokenUsage/updated', usage(1000, 50))
    const [first] = t.translate('turn/completed', turn('1'))
    t.translate('turn/started', turn('2'))
    t.translate('thread/tokenUsage/updated', usage(2500, 80))
    const [second] = t.translate('turn/completed', turn('2'))
    expect(first).toMatchObject({ type: 'turn_end', inputTokens: 1000, outputTokens: 50, costUsd: null, subtype: 'success', durationMs: 1200 })
    expect(second).toMatchObject({ inputTokens: 1500, outputTokens: 30 })
    expect(t.contextWindow).toBe(272_000)
  })

  it('ignores retried errors and explains the final one (recorded from a signed-out Codex 0.165.0)', () => {
    const t = new CodexTranslator('linux')
    const retry = {
      error: {
        message: 'Reconnecting... 2/5',
        codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } },
        additionalDetails: 'unexpected status 401 Unauthorized'
      },
      willRetry: true,
      threadId: 'th',
      turnId: 'u'
    }
    const final = {
      error: {
        message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header',
        codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } },
        additionalDetails: null
      },
      willRetry: false,
      threadId: 'th',
      turnId: 'u'
    }
    expect(t.translate('error', retry)).toEqual([])
    expect(t.translate('error', final)).toEqual([{ type: 'error', message: expect.stringMatching(/not signed in/) }])
    // The failed turn that follows does not repeat the message.
    expect(t.translate('turn/completed', { threadId: 'th', turn: { id: 'u', status: 'failed', error: final.error, durationMs: 9 } })).toEqual([
      expect.objectContaining({ type: 'turn_end', isError: true, subtype: 'failed', errors: [] })
    ])
    expect(describeCodexError({ message: 'x', codexErrorInfo: 'usageLimitExceeded', additionalDetails: null })).toMatch(/usage limit/)
    expect(versionFromUserAgent(INIT.userAgent)).toBe('0.165.0')
  })
})

describe('CodexSession', () => {
  it('starts a thread with the profile’s CODEX_HOME and the level’s sandbox, then runs turns in order', async () => {
    const { fake, events, s, done } = session('files-auto')
    await vi.waitFor(() => expect(fake.requests('thread/start')).toHaveLength(1))
    expect(fake.spawned).toMatchObject({ file: '/bin/codex', args: ['app-server'], env: { CODEX_HOME: '/h' }, cwd: '/repo' })
    expect(fake.requests('initialized')).toHaveLength(1)
    expect(fake.requests('thread/start')[0]?.params).toEqual({
      cwd: '/repo',
      sandbox: 'workspace-write',
      approvalPolicy: 'untrusted',
      developerInstructions: 'Be brief.'
    })
    await vi.waitFor(() => expect(events[0]).toMatchObject({ type: 'init', model: 'gpt-6.1-sol', cliVersion: '0.165.0' }))

    s.send('first')
    s.send('second')
    await vi.waitFor(() => expect(fake.requests('turn/start')).toHaveLength(1))
    expect(fake.requests('turn/start')[0]?.params).toEqual({ threadId: 'th-1', input: [{ type: 'text', text: 'first', text_elements: [] }] })
    fake.notify('turn/completed', { threadId: 'th-1', turn: { id: 'turn-1', status: 'completed', error: null, durationMs: 10 } })
    await vi.waitFor(() => expect(fake.requests('turn/start')).toHaveLength(2))

    await s.interrupt()
    expect(fake.requests('turn/interrupt')[0]?.params).toEqual({ threadId: 'th-1', turnId: 'turn-1' })
    s.stop()
    expect(fake.killed).toBe(true)
    // A stopped session ends quietly.
    await expect(done).resolves.toBeUndefined()
  })

  it('reads the plan limits after each turn and when Codex says they changed', async () => {
    const fake = new FakeCodex((msg) =>
      msg.method === 'account/rateLimits/read'
        ? {
            rateLimits: { limitId: 'codex', limitName: null, primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 2 }, secondary: null },
            rateLimitsByLimitId: null
          }
        : standardAnswers(msg)
    )
    const onLimits = vi.fn()
    const s = new CodexSession(
      { binary: 'c', env: {}, cwd: '/r', model: '', permissionLevel: 'autonomous', platform: 'linux', instructions: '', mcpServers: {}, clientVersion: '1' },
      { spawn: () => fake, emit: () => undefined, decide: () => ({ decision: 'allow' }), ask: async () => ({ behavior: 'allow' }), onLimits }
    )
    void s.start()
    await vi.waitFor(() => expect(fake.requests('thread/start')).toHaveLength(1))
    fake.notify('turn/completed', { threadId: 'th-1', turn: { id: 't', status: 'completed', error: null, durationMs: 1 } })
    await vi.waitFor(() => expect(onLimits).toHaveBeenCalledTimes(1))
    expect(onLimits).toHaveBeenCalledWith([{ window: 'five_hour', label: '5-hour window', usedPct: 40, resetsAt: 2000, source: 'codex' }])
    fake.notify('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: null, secondary: null } })
    await vi.waitFor(() => expect(onLimits).toHaveBeenCalledTimes(2))
    s.stop()
  })

  it('maps permission levels to Codex sandbox and approval policies', () => {
    expect(codexPolicy('validate-all')).toEqual({ sandbox: 'read-only', approvalPolicy: 'untrusted' })
    expect(codexPolicy('files-auto')).toEqual({ sandbox: 'workspace-write', approvalPolicy: 'untrusted' })
    expect(codexPolicy('autonomous')).toEqual({ sandbox: 'workspace-write', approvalPolicy: 'on-request' })
  })

  it('routes command approvals through the engine and the user', async () => {
    const { fake, questions } = session('validate-all')
    await vi.waitFor(() => expect(fake.requests('thread/start')).toHaveLength(1))
    const reply = await fake.ask(100, 'item/commandExecution/requestApproval', {
      threadId: 'th-1',
      turnId: 'turn-1',
      itemId: 'c1',
      command: 'npm test',
      cwd: '/repo',
      startedAtMs: 1
    })
    expect(reply.result).toEqual({ decision: 'accept' })
    expect(questions[0]).toMatchObject({ toolUseId: 'c1', toolName: 'Bash', input: { command: 'npm test' } })
  })

  it('denies what the engine denies without asking, and passes a denial message on as steering', async () => {
    const { fake, events, questions } = session('autonomous')
    await vi.waitFor(() => expect(fake.requests('thread/start')).toHaveLength(1))
    const push = await fake.ask(1, 'item/commandExecution/requestApproval', {
      threadId: 'th-1',
      turnId: 'turn-1',
      itemId: 'c2',
      command: 'git push origin main',
      startedAtMs: 1
    })
    expect(push.result).toEqual({ decision: 'decline' })
    expect(questions).toHaveLength(0)
    expect(events).toContainEqual(expect.objectContaining({ type: 'permission_denied', toolUseId: 'c2' }))

    const other = session('validate-all', () => ({ behavior: 'deny', message: 'use pnpm' }))
    await vi.waitFor(() => expect(other.fake.requests('thread/start')).toHaveLength(1))
    const declined = await other.fake.ask(2, 'item/commandExecution/requestApproval', {
      threadId: 'th-1',
      turnId: 'turn-1',
      itemId: 'c3',
      command: 'npm i',
      startedAtMs: 1
    })
    expect(declined.result).toEqual({ decision: 'decline' })
    await vi.waitFor(() => expect(other.fake.requests('turn/steer')).toHaveLength(1))
    expect(other.fake.requests('turn/steer')[0]?.params).toMatchObject({ expectedTurnId: 'turn-1', input: [{ text: expect.stringContaining('use pnpm') }] })
  })

  it('checks every path of a file change, using the paths from its item', async () => {
    const { fake, events, questions } = session('files-auto')
    await vi.waitFor(() => expect(fake.requests('thread/start')).toHaveLength(1))
    fake.notify('item/started', {
      threadId: 'th-1',
      turnId: 'turn-1',
      item: {
        type: 'fileChange',
        id: 'f1',
        status: 'inProgress',
        changes: [
          { path: '/repo/a.ts', kind: { type: 'update', move_path: null }, diff: '' },
          { path: '/etc/hosts', kind: { type: 'update', move_path: null }, diff: '' }
        ]
      }
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'tool_call')).toBe(true))
    const reply = await fake.ask(7, 'item/fileChange/requestApproval', { threadId: 'th-1', turnId: 'turn-1', itemId: 'f1', startedAtMs: 1 })
    // files-auto asks for writes outside the folder.
    expect(questions[0]).toMatchObject({ toolName: 'Edit', input: { paths: ['/repo/a.ts', '/etc/hosts'] } })
    expect(reply.result).toEqual({ decision: 'accept' })
  })

  it('answers requests it cannot serve without hanging the agent', async () => {
    const { fake } = session()
    await vi.waitFor(() => expect(fake.requests('thread/start')).toHaveLength(1))
    expect((await fake.ask(3, 'item/tool/requestUserInput', { questions: [] })).result).toEqual({ answers: {} })
    expect((await fake.ask(4, 'mcpServer/elicitation/request', {})).result).toMatchObject({ action: 'decline' })
    expect((await fake.ask(5, 'item/tool/call', {})).error).toMatchObject({ code: -32601 })
  })

  it('reports a failed start and ends with an error', async () => {
    const fake = new FakeCodex((msg) => (msg.method === 'thread/start' ? new Error('model not supported') : standardAnswers(msg)))
    const events: AgentEvent[] = []
    const s = new CodexSession(
      { binary: 'c', env: {}, cwd: '/r', model: 'x', permissionLevel: 'autonomous', platform: 'linux', instructions: '', mcpServers: {}, clientVersion: '1' },
      { spawn: () => fake, emit: (e) => events.push(e), decide: () => ({ decision: 'allow' }), ask: async () => ({ behavior: 'allow' }) }
    )
    await expect(s.start()).rejects.toThrow(/model not supported/)
    expect(events).toEqual([{ type: 'error', message: 'Codex did not start: model not supported' }])
    expect(fake.killed).toBe(true)
  })
})

describe('Codex runtime', () => {
  it('isolates the environment to the profile', () => {
    expect(buildCodexEnv({ PATH: '/b', OPENAI_API_KEY: 'sk', CODEX_HOME: '/me/.codex', CODEX_API_KEY: 'k' }, '/p/h')).toEqual({
      PATH: '/b',
      CODEX_HOME: '/p/h'
    })
  })

  it('writes the agent’s MCP servers as a Codex table limited to its tools', () => {
    expect(
      codexMcpServers([
        { slug: 'gh', transport: 'stdio', command: 'npx', args: ['x'], env: { T: '1' }, tools: ['list'] },
        { slug: 'web', transport: 'http', url: 'https://m/mcp', headers: { A: 'b' }, tools: ['get', 'put'] }
      ])
    ).toEqual({
      gh: { command: 'npx', args: ['x'], env: { T: '1' }, enabled_tools: ['list'] },
      web: { url: 'https://m/mcp', http_headers: { A: 'b' }, enabled_tools: ['get', 'put'] }
    })
  })

  it('tests the connection: signed out (recorded), then signed in with a plan', async () => {
    const signedOut = new FakeCodex((msg) => {
      if (msg.method === 'initialize') return INIT
      if (msg.method === 'account/read') return { account: null, requiresOpenaiAuth: true }
      if (msg.method === 'model/list') return { data: [{ id: 'gpt-6.1-sol', model: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', description: 'Latest', hidden: false, isDefault: true }], nextCursor: null }
      return undefined
    })
    const target = { binary: 'c', env: {}, cwd: '/', clientVersion: '1' }
    const out = await testCodexConnection(() => probeCodex(() => signedOut, target))
    expect(out).toMatchObject({ ok: false, status: 'Not signed in', models: [{ value: 'gpt-6.1-sol' }] })
    expect(signedOut.killed).toBe(true)

    const signedIn = new FakeCodex((msg) => {
      if (msg.method === 'account/read') return { account: { type: 'chatgpt', email: 'me@x.org', planType: 'plus' }, requiresOpenaiAuth: true }
      if (msg.method === 'account/rateLimits/read')
        return {
          rateLimits: { limitId: 'codex', limitName: null, primary: null, secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1 }, planType: 'plus' },
          rateLimitsByLimitId: null
        }
      if (msg.method === 'model/list') return { data: [], nextCursor: null }
      return msg.method === 'initialize' ? INIT : undefined
    })
    const probe = await probeCodex(() => signedIn, target)
    expect(probe.rateLimits?.rateLimits.secondary?.usedPercent).toBe(12)
    expect(await testCodexConnection(async () => probe)).toMatchObject({ ok: true, email: 'me@x.org', subscriptionType: 'plus' })
  })
})
