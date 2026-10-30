import { t } from '@shared/i18n'
import { randomUUID } from 'node:crypto'
import { AppError } from '@shared/errors'
import { mcpServerInputSchema, mcpServerUpdateSchema, slugify, type McpServerInput, type McpServerUpdate } from '@shared/mcp'
import type { Db } from '../services/db/database'
import type { Cipher } from '../services/secrets'
import type { McpPreset, PresetParam } from '@shared/mcp-catalog'

/** A server as main sees it, secrets included. Never sent to the renderer as is. */
export interface McpServerRecord {
  id: string
  name: string
  slug: string
  transport: 'stdio' | 'http'
  command: string
  args: string[]
  url: string
  env: Record<string, string>
  headers: Record<string, string>
  enabled: boolean
  presetId: string | null
  createdAt: number
}

interface Row {
  id: string
  name: string
  slug: string
  transport: string
  command: string
  args_json: string
  url: string
  secrets: Buffer | null
  enabled: number
  preset_id: string | null
  created_at: number
}

/** MCP server configs. Environment variables and headers are encrypted like API keys. */
export class McpStore {
  constructor(
    private readonly db: Db,
    private readonly cipher: Cipher
  ) {}

  list(): McpServerRecord[] {
    const rows = this.db.prepare('SELECT * FROM mcp_servers ORDER BY created_at').all() as Row[]
    return rows.map((r) => this.toRecord(r))
  }

  get(id: string): McpServerRecord {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new AppError('not_found', t('This MCP server no longer exists'))
    return this.toRecord(row)
  }

  create(input: McpServerInput, presetId: string | null = null): McpServerRecord {
    const data = mcpServerInputSchema.parse(input)
    const id = randomUUID()
    const now = Date.now()
    const env = data.transport === 'stdio' ? data.env : {}
    const headers = data.transport === 'http' ? data.headers : {}
    this.db
      .prepare(
        `INSERT INTO mcp_servers (id, name, slug, transport, command, args_json, url, secrets, env_keys, header_keys, enabled, preset_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.name,
        this.uniqueSlug(data.name),
        data.transport,
        data.transport === 'stdio' ? data.command : '',
        JSON.stringify(data.transport === 'stdio' ? data.args : []),
        data.transport === 'http' ? data.url : '',
        this.seal(env, headers),
        JSON.stringify(Object.keys(env)),
        JSON.stringify(Object.keys(headers)),
        data.enabled ? 1 : 0,
        presetId,
        now,
        now
      )
    return this.get(id)
  }

  update(input: McpServerUpdate): McpServerRecord {
    const data = mcpServerUpdateSchema.parse(input)
    const current = this.get(data.id)
    const env = data.env ?? current.env
    const headers = data.headers ?? current.headers
    const secretsChanged = data.env !== undefined || data.headers !== undefined
    this.db
      .prepare(
        `UPDATE mcp_servers SET name = ?, command = ?, args_json = ?, url = ?, enabled = ?, updated_at = ?
         ${secretsChanged ? ', secrets = ?, env_keys = ?, header_keys = ?' : ''} WHERE id = ?`
      )
      .run(
        data.name ?? current.name,
        current.transport === 'stdio' ? (data.command ?? current.command) : '',
        JSON.stringify(current.transport === 'stdio' ? (data.args ?? current.args) : []),
        current.transport === 'http' ? (data.url ?? current.url) : '',
        (data.enabled ?? current.enabled) ? 1 : 0,
        Date.now(),
        ...(secretsChanged ? [this.seal(env, headers), JSON.stringify(Object.keys(env)), JSON.stringify(Object.keys(headers))] : []),
        data.id
      )
    return this.get(data.id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  }

  /** Names already used, for the import preview. */
  names(): Set<string> {
    return new Set(this.list().map((s) => s.name.toLowerCase()))
  }

  private uniqueSlug(name: string): string {
    const taken = new Set((this.db.prepare('SELECT slug FROM mcp_servers').all() as Array<{ slug: string }>).map((r) => r.slug))
    const base = slugify(name)
    let slug = base
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
    return slug
  }

  private seal(env: Record<string, string>, headers: Record<string, string>): Buffer | null {
    if (Object.keys(env).length === 0 && Object.keys(headers).length === 0) return null
    if (!this.cipher.available()) {
      throw new AppError(
        'secrets_unavailable',
        t('Environment variables and headers can hold tokens, and this system has no secure storage for them. On Linux, install and unlock a keyring.')
      )
    }
    return this.cipher.encrypt(JSON.stringify({ env, headers }))
  }

  private toRecord(row: Row): McpServerRecord {
    let secrets: { env?: Record<string, string>; headers?: Record<string, string> } = {}
    if (row.secrets) {
      try {
        secrets = JSON.parse(this.cipher.decrypt(row.secrets)) as typeof secrets
      } catch {
        secrets = {}
      }
    }
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      transport: row.transport === 'http' ? 'http' : 'stdio',
      command: row.command,
      args: JSON.parse(row.args_json) as string[],
      url: row.url,
      env: secrets.env ?? {},
      headers: secrets.headers ?? {},
      enabled: row.enabled === 1,
      presetId: row.preset_id,
      createdAt: row.created_at
    }
  }

  /** Presets the user saved. */
  presets(): McpPreset[] {
    const rows = this.db.prepare('SELECT * FROM mcp_presets ORDER BY created_at').all() as PresetRow[]
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      title: r.title,
      description: r.description,
      publisher: t('Your preset'),
      source: '',
      transport: r.transport === 'http' ? 'http' : 'stdio',
      command: r.command,
      args: JSON.parse(r.args_json) as string[],
      url: r.url,
      params: JSON.parse(r.params_json) as PresetParam[],
      tools: [],
      toolChars: 0,
      requires: '',
      builtin: false
    }))
  }

  /**
   * Saves a server as a preset. Its command, arguments and URL are kept; the values of its
   * environment variables and headers are not, only their names, asked again at install.
   */
  savePreset(serverId: string, title: string, description: string): McpPreset[] {
    const server = this.get(serverId)
    const params: PresetParam[] = [
      ...Object.keys(server.env).map((name, i) => ({
        key: `env${i}`,
        label: name,
        hint: '',
        kind: 'secret' as const,
        required: true,
        target: { type: 'env' as const, name }
      })),
      ...Object.keys(server.headers).map((name, i) => ({
        key: `header${i}`,
        label: name,
        hint: '',
        kind: 'secret' as const,
        required: true,
        target: { type: 'header' as const, name, prefix: '' }
      }))
    ]
    this.db
      .prepare(
        `INSERT INTO mcp_presets (id, title, description, name, transport, command, args_json, url, params_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), title, description, server.name, server.transport, server.command, JSON.stringify(server.args), server.url, JSON.stringify(params), Date.now())
    return this.presets()
  }

  deletePreset(id: string): McpPreset[] {
    this.db.prepare('DELETE FROM mcp_presets WHERE id = ?').run(id)
    return this.presets()
  }
}

interface PresetRow {
  id: string
  title: string
  description: string
  name: string
  transport: string
  command: string
  args_json: string
  url: string
  params_json: string
  created_at: number
}
