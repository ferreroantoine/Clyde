import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEventEnvelope, AgentSessionInfo } from '@shared/agent'
import { migrate } from '../services/db/database'
import { SecretsService } from '../services/secrets'
import { ProfilesService } from '../services/profiles'
import { AgentManager, MAX_ACTIVE_SESSIONS } from './manager'
import { fakeQuery, sdk, type FakeContext } from './claude-code/fake-query'

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('no electron in tests') } }, safeStorage: {} }))

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function setup(script: (ctx: FakeContext) => AsyncGenerator<never>, { workspace = true } = {}) {
  const db = new Database(':memory:')
  migrate(db)
  const dir = mkdtempSync(join(tmpdir(), 'atelier-agents-'))
  const binary = join(dir, 'claude')
  writeFileSync(binary, '')
  const repo = mkdtempSync(join(tmpdir(), 'atelier-repo-'))
  const profiles = new ProfilesService(db, new SecretsService(db, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' }), {
    profilesRoot: join(dir, 'profiles'),
    distribution: false
  })
  const profile = profiles.create({ name: 'Perso', color: '#6366f1', auth: 'subscription', defaultModel: 'sonnet' })
  const events: AgentEventEnvelope[] = []
  const sessions: AgentSessionInfo[] = []
  const { query, calls } = fakeQuery(script as never)
  const manager = new AgentManager({
    profiles,
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
  return { manager, profile, profiles, events, calls, statuses, repo }
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
})
