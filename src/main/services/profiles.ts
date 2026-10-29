import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import {
  DEFAULT_OLLAMA_URL,
  KIND_AUTH,
  PROFILE_KIND_LABELS,
  profileCreateSchema,
  profileUpdateSchema,
  type AuthMode,
  type Profile,
  type ProfileCreate,
  type ProfileKind,
  type ProfileUpdate
} from '@shared/profiles'
import type { Db } from './db/database'
import type { SecretsService } from './secrets'
import { isInside } from './paths'

const API_KEY = 'apiKey'

interface Row {
  id: string
  kind: string
  name: string
  label: string
  color: string
  auth: string
  default_model: string
  base_url: string
  created_at: number
  updated_at: number
}

export interface ProfilesOptions {
  /** Parent of the per-profile Claude Code config dirs. */
  profilesRoot: string
  distribution: boolean
  onChanged?: (profiles: Profile[]) => void
}

export class ProfilesService {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretsService,
    private readonly opts: ProfilesOptions
  ) {}

  private toProfile(row: Row): Profile {
    const auth = row.auth as AuthMode
    return {
      id: row.id,
      kind: row.kind as ProfileKind,
      name: row.name,
      label: row.label,
      color: row.color,
      auth,
      defaultModel: row.default_model,
      baseUrl: row.base_url,
      hasApiKey: auth === 'api-key' && this.secrets.has(row.id, API_KEY),
      personalUse: auth === 'subscription',
      usable: !(this.opts.distribution && auth === 'subscription'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  list(): Profile[] {
    const rows = this.db.prepare('SELECT * FROM profiles ORDER BY created_at').all() as Row[]
    return rows.map((r) => this.toProfile(r))
  }

  get(id: string): Profile {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new AppError('not_found', 'This profile no longer exists')
    return this.toProfile(row)
  }

  /** Throws when this build does not allow the profile. */
  requireUsable(id: string): Profile {
    const profile = this.get(id)
    if (!profile.usable) {
      throw new AppError('not_allowed', 'Claude subscription profiles are disabled in this build. Use an API key profile.')
    }
    return profile
  }

  create(input: ProfileCreate): Profile {
    const data = profileCreateSchema.parse(input)
    if (!KIND_AUTH[data.kind].includes(data.auth)) {
      throw new AppError('invalid_request', `${PROFILE_KIND_LABELS[data.kind]} accounts cannot use ${data.auth} sign-in`)
    }
    if (data.auth === 'subscription' && this.opts.distribution) {
      throw new AppError('not_allowed', 'Claude subscription profiles are disabled in this build. Use an API key profile.')
    }
    if (data.auth === 'api-key' && !data.apiKey) throw new AppError('invalid_request', 'An API key is required')
    if (data.auth !== 'api-key' && data.apiKey) {
      throw new AppError('invalid_request', 'This account does not use an API key')
    }
    const baseUrl = data.kind === 'ollama' ? normalizeUrl(data.baseUrl || DEFAULT_OLLAMA_URL) : ''
    const id = randomUUID()
    const now = Date.now()
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO profiles (id, kind, name, label, color, auth, default_model, base_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, data.kind, data.name, data.label, data.color, data.auth, data.defaultModel, baseUrl, now, now)
      if (data.apiKey) this.secrets.set(id, API_KEY, data.apiKey)
    })()
    if (data.kind === 'claude-code') this.configDir(id)
    this.changed()
    return this.get(id)
  }

  update(input: ProfileUpdate): Profile {
    const data = profileUpdateSchema.parse(input)
    const current = this.get(data.id)
    if (data.apiKey && current.auth !== 'api-key') {
      throw new AppError('invalid_request', 'This account does not use an API key')
    }
    const baseUrl =
      current.kind === 'ollama' && data.baseUrl !== undefined ? normalizeUrl(data.baseUrl || DEFAULT_OLLAMA_URL) : current.baseUrl
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE profiles SET name = ?, label = ?, color = ?, default_model = ?, base_url = ?, updated_at = ? WHERE id = ?'
        )
        .run(
          data.name ?? current.name,
          data.label ?? current.label,
          data.color ?? current.color,
          data.defaultModel ?? current.defaultModel,
          baseUrl,
          Date.now(),
          data.id
        )
      if (data.apiKey) this.secrets.set(data.id, API_KEY, data.apiKey)
    })()
    this.changed()
    return this.get(data.id)
  }

  /** Removes the profile, its secrets and its config dir, which holds that account's Claude Code login. */
  delete(id: string): void {
    this.get(id)
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
    const dir = this.dirOf(id)
    if (isInside(this.opts.profilesRoot, dir) && dir !== this.opts.profilesRoot) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    }
    this.changed()
  }

  /** The profile's own CLAUDE_CONFIG_DIR, created on demand. Only Claude Code profiles use it. */
  configDir(id: string): string {
    const dir = this.dirOf(id)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  apiKey(id: string): string | null {
    return this.secrets.get(id, API_KEY)
  }

  private dirOf(id: string): string {
    // Ids are UUIDs generated here, so they are always a single safe path segment.
    return join(this.opts.profilesRoot, id)
  }

  private changed(): void {
    this.opts.onChanged?.(this.list())
  }
}

/** Drops a trailing slash and an `/v1` suffix people paste from OpenAI-style docs. */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
}
