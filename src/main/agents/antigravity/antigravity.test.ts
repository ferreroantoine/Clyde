import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@shared/agent'
import type { PtyProcess, PtySpawnOptions } from '../cli/pty-process'
import { PtyLineReader, parseAgyEvent, stripAnsi } from './stream'
import { AgyTranslator } from './translate'
import { AntigravitySession, MAX_PROMPT_CHARS } from './session'
import {
  agyArgs,
  agyMcpConfig,
  agyPaths,
  agyPermissions,
  buildAgyEnv,
  parseAgyModels,
  testAntigravityConnection,
  writeAgyConfig
} from './runtime'

const line = (o: unknown) => `${JSON.stringify(o)}\r\n`

/** A scripted agy run: writes its output in chunks, then exits. */
class FakePty implements PtyProcess {
  private dataListeners: Array<(d: string) => void> = []
  private exitListeners: Array<(c: number) => void> = []
  written: string[] = []
  killed = false
  constructor(readonly opts: PtySpawnOptions) {}
  onData(l: (d: string) => void) {
    this.dataListeners.push(l)
  }
  onExit(l: (c: number) => void) {
    this.exitListeners.push(l)
  }
  write(d: string) {
    this.written.push(d)
  }
  kill() {
    this.killed = true
    this.exit(1)
  }
  out(data: string) {
    this.dataListeners.forEach((l) => l(data))
  }
  exit(code: number) {
    this.exitListeners.forEach((l) => l(code))
  }
}

const RESULT = (conversation: string, extra: Record<string, unknown> = {}) => ({
  event: 'result',
  result: {
    conversation_id: conversation,
    status: 'SUCCESS',
    response: 'Done',
    duration_seconds: 2.5,
    num_turns: 1,
    usage: { input_tokens: 900, output_tokens: 40, thinking_tokens: 10, cache_read_tokens: 100, total_tokens: 1050 },
    ...extra
  }
})

describe('agy stream through a pty', () => {
  it('strips terminal sequences and CRLF, and joins a JSON line the terminal cut in two', () => {
    const reader = new PtyLineReader()
    const json = JSON.stringify({ event: 'init', init: { cwd: 'C:\\r', tools: ['run_command'], permission_mode: 'request-review' } })
    const items = [
      ...reader.push('\x1b[?25l\x1b]0;agy\x07'),
      ...reader.push(`${json.slice(0, 30)}\r\n${json.slice(30)}\r\n`),
      ...reader.push('\x1b[33mNotice: command(npm test) was denied\x1b[0m\r\n'),
      ...reader.push(line(RESULT('c1')).slice(0, 12)),
      ...reader.flush()
    ]
    expect(items[0]).toEqual({ kind: 'event', event: { event: 'init', cwd: 'C:\\r', tools: ['run_command'], permission_mode: 'request-review' } })
    expect(items[1]).toEqual({ kind: 'text', line: 'Notice: command(npm test) was denied' })
    expect(items[2]?.kind).toBe('text')
    expect(stripAnsi('\x1b[1;32mok\x1b[0m')).toBe('ok')
  })

  it('accepts flat and nested payloads and ignores other objects', () => {
    expect(parseAgyEvent({ event: 'result', status: 'ERROR' })).toEqual({ event: 'result', status: 'ERROR' })
    expect(parseAgyEvent({ event: 'step_update', step_update: { step_index: 2 } })).toEqual({ event: 'step_update', step_index: 2 })
    expect(parseAgyEvent({ event: 'telemetry' })).toBeNull()
  })
})

describe('AgyTranslator', () => {
  it('maps text steps, tool steps and the result', () => {
    const t = new AgyTranslator('t1')
    const events = [
      ...t.translate({ event: 'step_update', conversation_id: 'c1', step_index: 0, step_type: 'user_input', state: 'DONE' }),
      ...t.translate({ event: 'step_update', step_index: 1, step_type: 'agent_response', state: 'ACTIVE', text_delta: 'Look' }),
      ...t.translate({ event: 'step_update', step_index: 1, step_type: 'agent_response', state: 'DONE', text_delta: 'ing.' }),
      ...t.translate({
        event: 'step_update',
        step_index: 2,
        step_type: 'tool',
        state: 'ACTIVE',
        tool_name: 'run_command',
        tool_info: { name: 'run_command', parameters: { CommandLine: 'git status' } }
      }),
      ...t.translate({
        event: 'step_update',
        step_index: 2,
        step_type: 'tool',
        state: 'DONE',
        tool_info: { name: 'run_command', parameters: {}, output: 'clean' }
      }),
      ...t.translate({ event: 'step_update', step_index: 3, step_type: 'tool', state: 'DONE', tool_info: { name: 'view_file', error: { type: 'io', message: 'missing' } } }),
      ...t.translate(parseAgyEvent(RESULT('c1')) as never)
    ]
    expect(events).toEqual([
      { type: 'text_delta', key: 't1:1', text: 'Look' },
      { type: 'text_delta', key: 't1:1', text: 'ing.' },
      { type: 'text', key: 't1:1', text: 'Looking.' },
      { type: 'tool_call', toolUseId: 't1:2', name: 'run_command', input: { CommandLine: 'git status' }, parentToolUseId: null },
      { type: 'tool_result', toolUseId: 't1:2', content: 'clean', isError: false },
      { type: 'tool_call', toolUseId: 't1:3', name: 'view_file', input: {}, parentToolUseId: null },
      { type: 'tool_result', toolUseId: 't1:3', content: 'missing', isError: true },
      { type: 'turn_end', isError: false, subtype: 'success', errors: [], costUsd: null, inputTokens: 1000, outputTokens: 50, durationMs: 2500, cacheReadTokens: 100 }
    ])
    expect(t.conversationId).toBe('c1')
  })
})

function harness(level: 'validate-all' | 'files-auto' | 'autonomous' = 'files-auto', instructions = 'Answer in French.') {
  const spawned: FakePty[] = []
  const events: AgentEvent[] = []
  const writeConfig = vi.fn()
  const s = new AntigravitySession(
    {
      binary: 'C:\\bin\\agy.exe',
      env: { HOME: 'C:\\p', USERPROFILE: 'C:\\p' },
      home: 'C:\\p',
      cwd: 'C:\\repo',
      model: 'gemini-3.8-flash',
      permissionLevel: level,
      instructions,
      servers: [],
      cliVersion: '1.4.7'
    },
    {
      spawn: (opts) => {
        const p = new FakePty(opts)
        spawned.push(p)
        return p
      },
      emit: (e) => events.push(e),
      writeConfig
    }
  )
  const done = s.start()
  return { s, spawned, events, writeConfig, done }
}

describe('AntigravitySession', () => {
  it('runs one agy per message, in order, resuming the conversation', async () => {
    const { s, spawned, events, writeConfig, done } = harness()
    expect(events[0]).toEqual({ type: 'init', model: 'gemini-3.8-flash', cliVersion: '1.4.7', cwd: 'C:\\repo', tools: [] })
    s.send('hello')
    s.send('again')
    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.opts.args).toEqual(['-p', 'Answer in French.\n\n---\n\nhello', '--output-format', 'stream-json', '--model', 'gemini-3.8-flash'])
    expect(writeConfig).toHaveBeenCalledWith('C:\\p', { level: 'files-auto', servers: [] })
    spawned[0]?.out(line({ event: 'init', init: { cwd: 'C:\\repo', tools: [], permission_mode: 'request-review', model: 'gemini-3.8-pro' } }))
    expect(events.at(-1)).toMatchObject({ type: 'init', model: 'gemini-3.8-pro' })
    spawned[0]?.out(line(RESULT('conv-9')))
    spawned[0]?.exit(0)
    expect(spawned).toHaveLength(2)
    expect(spawned[1]?.opts.args).toEqual(['-p', 'again', '--output-format', 'stream-json', '--model', 'gemini-3.8-flash', '--conversation', 'conv-9'])
    s.stop()
    expect(spawned[1]?.killed).toBe(true)
    await expect(done).resolves.toBeUndefined()
  })

  it('reports a run that ends without a result, with the reason agy printed', () => {
    const { s, spawned, events } = harness()
    s.send('hi')
    spawned[0]?.out('Error: Authentication required. Run agy to sign in.\r\n')
    spawned[0]?.exit(1)
    expect(events.slice(1)).toEqual([
      { type: 'error', message: expect.stringMatching(/not signed in/) },
      expect.objectContaining({ type: 'turn_end', isError: true })
    ])
  })

  it('attaches a soft-denial notice to the running tool', () => {
    const { s, spawned, events } = harness()
    s.send('run tests')
    spawned[0]?.out(line({ event: 'step_update', step_update: { step_index: 1, step_type: 'tool', state: 'ACTIVE', tool_info: { name: 'run_command' } } }))
    spawned[0]?.out('Tool command(npm test) was denied: requires approval\r\n')
    expect(events).toContainEqual({ type: 'permission_denied', toolUseId: 't1:1', toolName: 'run_command', reason: expect.stringContaining('denied') })
  })

  it('interrupts with Ctrl+C and ends the turn as interrupted', () => {
    vi.useFakeTimers()
    try {
      const { s, spawned, events } = harness()
      s.send('long job')
      void s.interrupt()
      expect(spawned[0]?.written).toEqual(['\x03'])
      vi.advanceTimersByTime(2000)
      expect(spawned[0]?.killed).toBe(true)
      expect(events.at(-1)).toMatchObject({ type: 'turn_end', subtype: 'interrupted', isError: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a message the Windows command line cannot carry', () => {
    const { s, spawned, events } = harness('files-auto', '')
    s.send('x'.repeat(MAX_PROMPT_CHARS + 1))
    expect(spawned).toHaveLength(0)
    expect(events[1]).toMatchObject({ type: 'error', message: expect.stringMatching(/too long/) })
  })
})

describe('Antigravity runtime', () => {
  it('points HOME at the profile and drops other accounts', () => {
    expect(buildAgyEnv({ PATH: 'p', GEMINI_API_KEY: 'k', AGY_ADC_AUTH: 'true', USERPROFILE: 'C:\\Users\\me' }, 'C:\\p', 'win32')).toEqual({
      PATH: 'p',
      HOME: 'C:\\p',
      USERPROFILE: 'C:\\p',
      NO_COLOR: '1',
      AGY_CLI_OSC7501: 'off'
    })
  })

  it('turns permission levels into rules, since headless agy cannot ask', () => {
    expect(agyPermissions('validate-all', ['gh/list']).deny).toEqual(expect.arrayContaining(['write_file(*)', 'command(*)', 'mcp(*)']))
    expect(agyPermissions('files-auto', []).deny).toContain('command(*)')
    expect(agyPermissions('files-auto', []).deny).not.toContain('write_file(*)')
    const auto = agyPermissions('autonomous', ['gh/list'])
    expect(auto.allow).toEqual(['command(*)', 'mcp(gh/list)'])
    expect(auto.deny).toContain('command(git push)')
  })

  it('writes rules and MCP servers into the profile home, keeping other settings', () => {
    const home = mkdtempSync(join(tmpdir(), 'agy-home-'))
    const paths = agyPaths(home)
    mkdirSync(join(paths.settings, '..'), { recursive: true })
    writeFileSync(paths.settings, '\uFEFF{"model":"gemini-3.8-flash","permissions":{"allow":["command(*)"]}}')
    const servers = [{ slug: 'gh', transport: 'stdio' as const, command: 'npx', args: ['gh-mcp'], env: { T: 'x' }, tools: ['list'] }]
    writeAgyConfig(home, { level: 'validate-all', servers })
    const settings = JSON.parse(readFileSync(paths.settings, 'utf8'))
    expect(settings.model).toBe('gemini-3.8-flash')
    expect(settings.permissions.allow).toEqual([])
    expect(JSON.parse(readFileSync(paths.mcp, 'utf8'))).toEqual(agyMcpConfig(servers))
    expect(agyMcpConfig([{ slug: 'web', transport: 'http', url: 'https://m', headers: {}, tools: ['a'] }])).toEqual({
      mcpServers: { web: { serverUrl: 'https://m', headers: {}, enabledTools: ['a'] } }
    })
  })

  it('keeps a prompt that starts with a dash from reading as a flag', () => {
    expect(agyArgs('-v please', { model: '', conversationId: null })[1]).toBe(' -v please')
  })

  it('reads model ids from agy models and tests the connection', async () => {
    expect(parseAgyModels('Available models:\n* gemini-3.8-flash   (default)\n  gemini-3.1-pro\n  claude-opus-5-5\n').map((m) => m.value)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.1-pro',
      'claude-opus-5-5'
    ])
    expect(await testAntigravityConnection(async () => ({ code: 0, output: 'gemini-3.8-flash\n' }))).toMatchObject({ ok: true, status: 'Signed in' })
    expect(await testAntigravityConnection(async () => ({ code: 1, output: 'Error: authentication required' }))).toMatchObject({
      ok: false,
      status: 'Not signed in'
    })
    expect(await testAntigravityConnection(async () => ({ code: null, output: '' }))).toMatchObject({ ok: false, status: 'Not connected' })
  })
})
