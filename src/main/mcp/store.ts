import { randomUUID } from 'node:crypto'
import { AppError } from '@shared/errors'
import { mcpServerInputSchema, mcpServerUpdateSchema, slugify, type McpServerInput, type McpServerUpdate } from '@shared/mcp'
import type { Db } from '../services/db/database'
import type { Cipher } from '../services/secrets'

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
    if (!row) throw new AppError('not_found', 'This MCP server no longer exists')
    return this.toRecord(row)
  }

  create(input: McpServerInput): McpServerRecord {
    const data = mcpServerInputSchema.parse(input)
    const id = randomUUID()
    const now = Date.now()
    const env = data.transport === 'stdio' ? data.env : {}
    const headers = data.transport === 'http' ? data.headers : {}
    this.db
      .prepare(
        `INSERT INTO mcp_servers (id, name, slug, transport, command, args_json, url, secrets, env_keys, header_keys, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        'Environment variables and headers can hold tokens, and this system has no secure storage for them. On Linux, install and unlock a keyring.'
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
      createdAt: row.created_at
    }
  }
}
