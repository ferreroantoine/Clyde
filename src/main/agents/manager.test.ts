import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEventEnvelope, AgentSessionInfo } from '@shared/agent'
import { migrate } from '../services/db/database'
import { SecretsService } from '../services/secrets'
import { ProfilesService } from '../services/profiles'
import { AgentManager, MAX_ACTIVE_SESSIONS, type AgentManagerDeps } from './manager'
import { fakeQuery, sdk, type FakeContext } from './claude-code/fake-query'
import type { ChatAdapter, ChatRequest } from './api/chat'

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('no electron in tests') } }, safeStorage: {} }))

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

/** Stands in for the MCP hub: one connected server, `docs`, with `search` and `delete`. */
function fakeMcp() {
  const tool = (name: string) => ({
    name: `mcp__docs__${name}`,
    qualifiedName: `mcp__docs__${name}`,
    description: name,
    inputSchema: { type: 'object' }
  })
  return {
    toolSpecs: vi.fn((allowed: ReadonlySet<string>) => [tool('search'), tool('delete')].filter((t) => allowed.has(t.qualifiedName))),
    callTool: vi.fn(async (name: string) => ({ content: `ran ${name}`, isError: false })),
    agentServers: vi.fn((allowed: ReadonlySet<string>) =>
      allowed.size ? [{ slug: 'docs', transport: 'stdio' as const, command: 'docs-mcp', args: [], env: {}, tools: ['search'] }] : []
    ),
    claudeCodeConfig: vi.fn((allowed: ReadonlySet<string>) => ({
      servers: allowed.size ? { docs: { type: 'stdio' as const, command: 'docs-mcp', args: [], env: {} } } : {},
      disallowed: allowed.size ? ['mcp__docs__delete'] : []
    }))
  }
}

function setup(
  script: (ctx: FakeContext) => AsyncGenerator<never>,
  { workspace = true, adapter }: { workspace?: boolean; adapter?: ChatAdapter } = {}
) {
  const db = new Database(':memory:')
  migrate(db)
  const dir = mkdtempSync(join(tmpdir(), 'atelier-agents-'))
  const binary = join(dir, 'claude')
  writeFileSync(binary, '')
  const repo = mkdtempSync(join(tmpdir(), 'atelier-repo-'))
  const profiles = new ProfilesService(db, new SecretsService(db, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' }), {
    dataRoot: join(dir, 'profiles'),
    distribution: false
  })
  const profile = profiles.create({ name: 'Perso', color: '#6366f1', auth: 'subscription', defaultModel: 'sonnet' })
  const events: AgentEventEnvelope[] = []
  const sessions: AgentSessionInfo[] = []
  const { query, calls } = fakeQuery(script as never)
  const mcp = fakeMcp()
  const cliSpawns: Array<{ file: string; args: string[]; env: Record<string, string>; cwd: string }> = []
  const manager = new AgentManager({
    profiles,
    resolveCodex: () => '/bin/codex',
    resolveAntigravity: () => '/bin/agy',
    // A Codex that never answers is enough to see how the manager starts it.
    spawnCli: (opts) => {
      cliSpawns.push(opts)
      return {
        transport: { write: () => undefined, onLine: () => undefined, onClose: () => undefined },
        exited: new Promise(() => undefined),
        stderrTail: () => '',
        kill: () => undefined
      }
    },
    spawnPty: () => {
      throw new Error('no agy in this test')
    },
    mcp: mcp as unknown as AgentManagerDeps['mcp'],
    createAdapter: () => {
      if (!adapter) throw new Error('no adapter in this test')
      return adapter
    },
    hasPwsh: () => false,
    platform: 'linux',
    claudeCodePath: () => binary,
    workspaceRoot: () => (workspace ? repo : null),
    query: async () => query,
    onEvent: (e) => events.push(e),
    onSession: (s) => sessions.push(s),
    clientApp: 'atelier/test',
    baseEnv: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-inherited' },
    log
  })
  // Status transitions; other session updates (e.g. the resolved model) repeat the current status.
  const statuses = (id: string) =>
    sessions
      .filter((s) => s.id === id)
      .map((s) => s.status)
      .filter((status, i, all) => status !== all[i - 1])
  return { manager, profile, profiles, events, calls, statuses, repo, mcp, cliSpawns }
}

async function* idle(ctx: FakeContext) {
  yield sdk.init()
  while (await ctx.nextUser()) yield sdk.result()
}

describe('AgentManager', () => {
  it('runs a session in the workspace with the profile environment', async () => {
    const { manager, profile, calls, statuses, events, repo, profiles } = setup(idle as never)
    const info = await manager.start({ profileId: profile.id })
    expect(info).toMatchObject({ profileId: profile.id, model: 'sonnet', cwd: repo, permissionLevel: 'validate-all' })
    expect(calls[0]?.env).toEqual({
      PATH: '/usr/bin',
      CLAUDE_CONFIG_DIR: profiles.configDir(profile.id),
      CLAUDE_AGENT_SDK_CLIENT_APP: 'atelier/test'
    })

    manager.send(info.id, 'hello')
    await vi.waitFor(() => expect(statuses(info.id).at(-1)).toBe('idle'))
    expect(statuses(info.id)).toEqual(['starting', 'idle', 'running', 'idle'])
    expect(manager.list()[0]?.model).toBe('claude-sonnet-5')
    expect(events.map((e) => e.event.type)).toContain('user')
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))

    manager.stop(info.id)
    expect(statuses(info.id).at(-1)).toBe('stopped')
    expect(() => manager.send(info.id, 'again')).toThrow(/ended/)
  })

  it('shows approvals in the session status and cancels them on stop', async () => {
    let hookResult: unknown
    const { manager, profile, statuses } = setup((async function* (ctx: FakeContext) {
      await ctx.nextUser()
      hookResult = await ctx.preToolUse('Bash', { command: 'npm test' }, 'tu1')
      yield sdk.result()
    }) as never)
    const info = await manager.start({ profileId: profile.id })
    manager.send(info.id, 'test it')
    await vi.waitFor(() => expect(statuses(info.id).at(-1)).toBe('awaiting-approval'))
    manager.stop(info.id)
    await vi.waitFor(() => expect(hookResult).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } }))
    expect(statuses(info.id).at(-1)).toBe('stopped')
  })

  it('needs an open folder and caps concurrent agents', async () => {
    const none = setup(idle as never, { workspace: false })
    await expect(none.manager.start({ profileId: none.profile.id })).rejects.toThrow(/Open a folder/)

    const { manager, profile } = setup(idle as never)
    for (let i = 0; i < MAX_ACTIVE_SESSIONS; i++) await manager.start({ profileId: profile.id })
    await expect(manager.start({ profileId: profile.id })).rejects.toThrow(/already running/)
    manager.stop(manager.list()[0]?.id ?? '')
    await expect(manager.start({ profileId: profile.id })).resolves.toMatchObject({ status: 'idle' })
  })

  it('gives Claude Code only the MCP servers and tools the agent may use', async () => {
    const { manager, profile, calls } = setup(idle as never)
    await manager.start({ profileId: profile.id, mcpTools: ['mcp__docs__search'], systemPrompt: 'Be brief.' })
    expect(calls[0]).toMatchObject({
      mcpServers: { docs: { type: 'stdio', command: 'docs-mcp' } },
      disallowedTools: ['AskUserQuestion', 'mcp__docs__delete'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Be brief.' }
    })
    await manager.start({ profileId: profile.id })
    expect(calls[1]).not.toHaveProperty('mcpServers')
  })

  it('runs API accounts in the in-house loop with their allowed MCP tools', async () => {
    const requests: ChatRequest[] = []
    const replies = [
      { toolCalls: [{ id: 'c1', name: 'mcp__docs__search', input: { q: 'x' } }, { id: 'c2', name: 'mcp__docs__delete', input: {} }] },
      { toolCalls: [] }
    ]
    const adapter: ChatAdapter = {
      async *stream(req) {
        requests.push(structuredClone({ ...req, signal: undefined }) as unknown as ChatRequest)
        const reply = replies.shift() ?? { toolCalls: [] }
        yield { type: 'done', text: 'ok', toolCalls: reply.toolCalls, stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
      },
      listModels: async () => [{ value: 'qwen3', displayName: 'qwen3', description: '' }]
    }
    const { manager, profiles, events, mcp } = setup(idle as never, { adapter })
    const ollama = profiles.create({ kind: 'ollama', name: 'Local', color: '#64748b', auth: 'none' })
    const info = await manager.start({ profileId: ollama.id, mcpTools: ['mcp__docs__search'], permissionLevel: 'autonomous' })
    expect(info).toMatchObject({ kind: 'ollama', model: 'qwen3', mcpTools: ['mcp__docs__search'] })

    manager.send(info.id, 'search the docs')
    await vi.waitFor(() => expect(events.some((e) => e.event.type === 'turn_end')).toBe(true))
    expect(requests[0]?.tools.map((t) => t.name)).toEqual([
      'read_file',
      'write_file',
      'edit_file',
      'list_files',
      'run_command',
      'mcp__docs__search'
    ])
    expect(requests[0]?.system).toContain('Linux')
    // The allowed tool ran through the hub; the other one was refused without reaching it.
    expect(mcp.callTool).toHaveBeenCalledTimes(1)
    expect(mcp.callTool).toHaveBeenCalledWith('mcp__docs__search', { q: 'x' }, expect.any(AbortSignal))
    const results = events.flatMap((e) => (e.event.type === 'tool_result' ? [e.event] : []))
    expect(results).toEqual([
      { type: 'tool_result', toolUseId: 'c1', content: 'ran mcp__docs__search', isError: false },
      { type: 'tool_result', toolUseId: 'c2', content: expect.stringMatching(/not in this agent's MCP tools/), isError: true }
    ])
    manager.stop(info.id)
  })

  it('starts Codex accounts in the profile’s own CODEX_HOME', async () => {
    const { manager, profiles, cliSpawns, repo } = setup(idle as never)
    const codex = profiles.create({ kind: 'codex', name: 'ChatGPT', color: '#22c55e', auth: 'subscription' })
    const info = await manager.start({ profileId: codex.id, mcpTools: ['mcp__docs__search'] })
    expect(info).toMatchObject({ kind: 'codex', status: 'idle' })
    expect(cliSpawns[0]).toEqual({ file: '/bin/codex', args: ['app-server'], env: { PATH: '/usr/bin', CODEX_HOME: profiles.configDir(codex.id) }, cwd: repo })
    manager.stop(info.id)
  })

  it('keeps two Antigravity sessions of one account from using different rules', async () => {
    const { manager, profiles } = setup(idle as never)
    const agy = profiles.create({ kind: 'antigravity', name: 'Google', color: '#0ea5e9', auth: 'subscription' })
    expect(() => profiles.create({ kind: 'antigravity', name: 'Google 2', color: '#0ea5e9', auth: 'subscription' })).toThrow(/already/)
    const first = await manager.start({ profileId: agy.id, permissionLevel: 'files-auto' })
    await expect(manager.start({ profileId: agy.id, permissionLevel: 'autonomous' })).rejects.toThrow(/different permission level/)
    await expect(manager.start({ profileId: agy.id, permissionLevel: 'files-auto' })).resolves.toMatchObject({ kind: 'antigravity' })
    manager.stop(first.id)
  })
})
