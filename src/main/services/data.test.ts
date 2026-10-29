import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { McpServer, McpServerInput } from '@shared/mcp'
import { migrate } from './db/database'
import { SecretsService, type Cipher } from './secrets'
import { ProfilesService } from './profiles'
import { AgentDefinitionsService } from './agent-definitions'
import { MemorySettingsRepository, SettingsService } from './settings'
import { MetricsService } from '../metrics/metrics'
import { DataService } from './data'

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('no electron in tests') } }, safeStorage: {} }))

const cipher: Cipher = { available: () => true, encrypt: (s) => Buffer.from(`enc:${s}`), decrypt: (b) => b.toString().slice(4) }

function install() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  const settings = new SettingsService(new MemorySettingsRepository())
  const profiles = new ProfilesService(db, new SecretsService(db, cipher), { dataRoot: mkdtempSync(join(tmpdir(), 'data-')), distribution: false })
  const agents = new AgentDefinitionsService(db, () => undefined)
  const servers: McpServer[] = []
  const mcp = {
    list: () => servers,
    create: vi.fn((input: McpServerInput) => {
      servers.push({
        id: String(servers.length),
        name: input.name,
        slug: input.name.toLowerCase(),
        transport: input.transport,
        command: input.transport === 'stdio' ? input.command : '',
        args: input.transport === 'stdio' ? (input.args ?? []) : [],
        url: input.transport === 'http' ? input.url : '',
        envKeys: input.transport === 'stdio' ? Object.keys(input.env ?? {}) : [],
        headerKeys: input.transport === 'http' ? Object.keys(input.headers ?? {}) : [],
        enabled: input.enabled ?? true,
        status: 'disabled',
        error: null,
        tools: []
      })
      return servers
    })
  }
  const metrics = new MetricsService(db, { profiles: () => profiles.list(), activeSessions: () => [] })
  const data = new DataService({ db, settings, profiles, agents, mcp, metrics, activeSessionIds: () => [] })
  return { db, settings, profiles, agents, mcp, metrics, data }
}

describe('DataService', () => {
  it('exports the configuration without any secret, and imports it elsewhere', async () => {
    const a = install()
    a.settings.set('appearance.theme', 'dark')
    a.settings.set('general.recentWorkspaces', ['C:\\secret-project'])
    const sub = a.profiles.create({ kind: 'codex', name: 'ChatGPT', color: '#22c55e', auth: 'subscription' })
    a.profiles.create({ kind: 'openai', name: 'OpenAI', color: '#0ea5e9', auth: 'api-key', apiKey: 'sk-live-0123456789abcdefghij' })
    a.mcp.create({ transport: 'stdio', name: 'GitHub', command: 'npx', args: ['gh-mcp', '--token', 'ghp_SECRETSECRET'], env: { GITHUB_TOKEN: 'ghp_x' } })
    a.agents.create({ name: 'Reviewer', profileId: sub.id, model: '', systemPrompt: 'Review.', permissionLevel: 'files-auto', mcpTools: [] })
    a.metrics.savePrice({ kind: 'openai', modelPrefix: 'gpt-9', inputPerMTok: 1, outputPerMTok: 2 })

    const exported = a.data.exportConfig()
    const text = JSON.stringify(exported)
    for (const secret of ['sk-live', 'ghp_x', 'SECRETSECRET', 'secret-project']) expect(text).not.toContain(secret)
    expect(exported.mcpServers[0]).toMatchObject({ envKeys: ['GITHUB_TOKEN'] })

    const b = install()
    const summary = await b.data.importConfig(JSON.parse(text))
    expect(summary).toMatchObject({ settings: true, profiles: 1, mcpServers: 1, agents: 1, prices: 1 })
    expect(summary.skipped).toEqual([expect.stringContaining('OpenAI')])
    expect(b.settings.getAll().appearance.theme).toBe('dark')
    expect(b.mcp.list()[0]).toMatchObject({ name: 'GitHub', enabled: false, envKeys: ['GITHUB_TOKEN'] })
    expect(b.agents.list()[0]).toMatchObject({ name: 'Reviewer', permissionLevel: 'files-auto' })
    // Importing twice adds nothing.
    expect(await b.data.importConfig(JSON.parse(text))).toMatchObject({ profiles: 0, mcpServers: 0, agents: 0 })
    await expect(b.data.importConfig({ hello: 1 })).rejects.toThrow(/not an Atelier configuration/)
  })

  it('purges the history but keeps running sessions', () => {
    const { db, settings, profiles, agents, mcp, metrics } = install()
    const data = new DataService({ db, settings, profiles, agents, mcp, metrics, activeSessionIds: () => ['as-live'] })
    const add = db.prepare("INSERT INTO sessions (id, profile_id, profile_name, kind, cwd, status, started_at) VALUES (?, 'p', 'P', 'openai', '/', 'stopped', 1)")
    add.run('as-old')
    add.run('as-live')
    db.prepare("INSERT INTO session_events (session_id, seq, at, event) VALUES ('as-old', 1, 1, '{}')").run()
    expect(data.purgeHistory()).toEqual({ sessions: 1 })
    expect(db.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 'as-live' }])
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_events').get()).toEqual({ n: 0 })
  })
})
