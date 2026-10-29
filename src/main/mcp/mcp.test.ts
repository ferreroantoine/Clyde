import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@shared/mcp'
import { slugify } from '@shared/mcp'
import { migrate } from '../services/db/database'
import type { Cipher } from '../services/secrets'
import { McpStore } from './store'
import { apiToolName, contentText, McpHub, type McpConnection } from './hub'
import { claudeDesktopConfigPath, parseClaudeDesktopConfig } from './import-claude-desktop'

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('no electron in tests') } }, safeStorage: {} }))

const cipher = (available = true): Cipher => ({
  available: () => available,
  encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString('base64')}`),
  decrypt: (data) => Buffer.from(data.toString().slice(4), 'base64').toString()
})
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function store(available = true) {
  const db = new Database(':memory:')
  migrate(db)
  return { db, store: new McpStore(db, cipher(available)) }
}

const FIXTURE = join(__dirname, 'fixtures', 'echo-server.mjs')

describe('parseClaudeDesktopConfig', () => {
  it('reads stdio and remote servers and explains what it skips', () => {
    const parsed = parseClaudeDesktopConfig(
      JSON.stringify({
        mcpServers: {
          filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\work'] },
          github: { command: 'docker', args: ['run', 'ghcr.io/github/github-mcp-server'], env: { GITHUB_TOKEN: 'ghp_x', DEBUG: 1 } },
          linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer t' } },
          old: { type: 'sse', url: 'https://example.com/sse' },
          off: { command: 'x', disabled: true },
          broken: { args: [] }
        },
        globalShortcut: 'Ctrl+Space'
      })
    )
    expect(parsed.servers.map((s) => s.input)).toEqual([
      { transport: 'stdio', name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\work'], env: {} },
      { transport: 'stdio', name: 'github', command: 'docker', args: ['run', 'ghcr.io/github/github-mcp-server'], env: { GITHUB_TOKEN: 'ghp_x', DEBUG: '1' } },
      { transport: 'http', name: 'linear', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer t' } },
      { transport: 'http', name: 'old', url: 'https://example.com/sse', headers: {} }
    ])
    expect(parsed.skipped).toEqual([
      { name: 'off', reason: 'Disabled in the file' },
      { name: 'broken', reason: 'Neither a command nor an http(s) URL' }
    ])
  })

  it('rejects files that are not configs', () => {
    expect(() => parseClaudeDesktopConfig('nope')).toThrow(/not valid JSON/)
    expect(() => parseClaudeDesktopConfig('{"theme":"dark"}')).toThrow(/no "mcpServers"/)
  })

  it('knows where Claude Desktop keeps it', () => {
    expect(claudeDesktopConfigPath('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toBe(
      join('C:\\Users\\me\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json')
    )
  })
})

describe('McpStore', () => {
  it('encrypts env and headers and gives unique slugs', () => {
    const { db, store: s } = store()
    const a = s.create({ transport: 'stdio', name: 'GitHub', command: 'docker', env: { GITHUB_TOKEN: 'ghp_secret' } })
    const b = s.create({ transport: 'http', name: 'github', url: 'https://x.dev/mcp', headers: { Authorization: 'Bearer t' } })
    expect([a.slug, b.slug]).toEqual(['github', 'github-2'])
    expect(a.env).toEqual({ GITHUB_TOKEN: 'ghp_secret' })
    const raw = JSON.stringify(db.prepare('SELECT * FROM mcp_servers').all(), (_k, v) => (v?.type === 'Buffer' ? Buffer.from(v.data).toString() : v))
    expect(raw).not.toContain('ghp_secret')
    expect(raw).not.toContain('Bearer t')

    const updated = s.update({ id: a.id, args: ['run', 'img'], enabled: false })
    expect(updated).toMatchObject({ args: ['run', 'img'], enabled: false, env: { GITHUB_TOKEN: 'ghp_secret' } })
    expect(s.update({ id: a.id, env: {} }).env).toEqual({})
  })

  it('refuses secrets without secure storage but allows plain servers', () => {
    const { store: s } = store(false)
    expect(() => s.create({ transport: 'stdio', name: 'gh', command: 'x', env: { TOKEN: 't' } })).toThrow(/secure storage/)
    expect(s.create({ transport: 'stdio', name: 'fs', command: 'npx' }).slug).toBe('fs')
  })

  it('slugifies names for tool prefixes', () => {
    expect(slugify('Mon Serveur Été!')).toBe('mon-serveur-ete')
    expect(slugify('***')).toBe('server')
  })
})

type FakeTool = { name: string; description: string; inputSchema: Record<string, unknown> }

function fakeConnection(tools: FakeTool[] = [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }]) {
  let close: (error: Error | null) => void = () => undefined
  const connection: McpConnection = {
    listTools: async () => tools,
    callTool: vi.fn(async (name, args) => ({ content: `${name}:${JSON.stringify(args)}`, isError: false })),
    close: vi.fn(async () => undefined),
    onClose: (listener) => (close = listener),
    onToolsChanged: () => undefined
  }
  return { connection, drop: (err: Error | null) => close(err) }
}

describe('McpHub', () => {
  it('connects, exposes allowed tools and routes calls', async () => {
    const { store: s } = store()
    const fake = fakeConnection()
    const changes: McpServer[][] = []
    const hub = new McpHub(s, { onChanged: (list) => changes.push(list), connect: async () => fake.connection, log })
    hub.create({ transport: 'stdio', name: 'Docs', command: 'docs-mcp' })
    await vi.waitFor(() => expect(hub.list()[0]?.status).toBe('connected'))
    expect(hub.list()[0]?.tools).toEqual([{ name: 'search', qualifiedName: 'mcp__docs__search', description: 'Search' }])
    expect(changes.map((c) => c[0]?.status)).toEqual(['connecting', 'connecting', 'connected'])

    expect(hub.toolSpecs(new Set())).toEqual([])
    expect(hub.toolSpecs(new Set(['mcp__docs__search'])).map((t) => t.name)).toEqual(['mcp__docs__search'])
    await expect(hub.callTool('mcp__docs__search', { q: 'x' }, new AbortController().signal)).resolves.toEqual({
      content: 'search:{"q":"x"}',
      isError: false
    })
    await expect(hub.callTool('mcp__other__x', {}, new AbortController().signal)).resolves.toMatchObject({ isError: true })

    fake.drop(new Error('process exited'))
    expect(hub.list()[0]).toMatchObject({ status: 'error', error: 'process exited', tools: [] })
  })

  it('reports connection failures and stays off when disabled', async () => {
    const { store: s } = store()
    const hub = new McpHub(s, { onChanged: () => undefined, connect: async () => Promise.reject(new Error('spawn ENOENT')), log })
    hub.create({ transport: 'stdio', name: 'Broken', command: 'nope' })
    await vi.waitFor(() => expect(hub.list()[0]).toMatchObject({ status: 'error', error: 'spawn ENOENT' }))
    const [server] = hub.list()
    hub.update({ id: server?.id ?? '', enabled: false })
    expect(hub.list()[0]).toMatchObject({ status: 'disabled', error: null })
    await expect(hub.reconnect(server?.id ?? '')).rejects.toThrow(/Enable/)
  })

  it('builds Claude Code configs with only the allowed tools visible', async () => {
    const { store: s } = store()
    const tools = ['search', 'delete'].map((name) => ({ name, description: '', inputSchema: {} }))
    const hub = new McpHub(s, { onChanged: () => undefined, connect: async () => fakeConnection(tools).connection, log })
    hub.create({ transport: 'stdio', name: 'Docs', command: 'docs-mcp', args: ['--x'] })
    hub.create({ transport: 'http', name: 'Other', url: 'https://o.dev/mcp' })
    await vi.waitFor(() => expect(hub.list().every((x) => x.status === 'connected')).toBe(true))
    expect(hub.claudeCodeConfig(new Set(['mcp__docs__search']))).toEqual({
      servers: { docs: { type: 'stdio', command: 'docs-mcp', args: ['--x'], env: {} } },
      disallowed: ['mcp__docs__delete']
    })
  })

  it('talks to a real stdio server', async () => {
    const { store: s } = store()
    const hub = new McpHub(s, { onChanged: () => undefined, log })
    hub.create({ transport: 'stdio', name: 'Echo', command: process.execPath, args: [FIXTURE], env: { ECHO_USER: 'ada' } })
    await vi.waitFor(() => expect(hub.list()[0]?.status).toBe('connected'), { timeout: 15_000 })
    expect(hub.list()[0]?.tools.map((t) => t.name)).toEqual(['echo', 'add', 'whoami'])
    const signal = new AbortController().signal
    await expect(hub.callTool('mcp__echo__add', { a: 2, b: 3 }, signal)).resolves.toEqual({ content: '5', isError: false })
    await expect(hub.callTool('mcp__echo__whoami', {}, signal)).resolves.toEqual({ content: 'ada', isError: false })
    const spec = hub.toolSpecs(new Set(['mcp__echo__echo']))[0]
    expect(spec?.inputSchema).toMatchObject({ type: 'object', properties: { text: { type: 'string' } } })
    await hub.dispose()
  }, 20_000)
})

describe('helpers', () => {
  it('flattens MCP content and shortens long tool names', () => {
    expect(contentText([{ type: 'text', text: 'a' }, { type: 'image', mimeType: 'image/png' }])).toBe('a\n[image image/png]')
    const long = `mcp__${'s'.repeat(40)}__${'t'.repeat(40)}`
    expect(apiToolName(long)).toHaveLength(64)
    expect(apiToolName(long)).toBe(apiToolName(long))
    expect(apiToolName('mcp__a__b')).toBe('mcp__a__b')
  })
})
