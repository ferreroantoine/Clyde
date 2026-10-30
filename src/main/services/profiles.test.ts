import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from './db/database'
import { SecretsService, type Cipher } from './secrets'
import { ProfilesService } from './profiles'

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('no electron in tests') } }, safeStorage: {} }))

/** Reversible stand-in for safeStorage that never leaves the value readable in the database. */
function fakeCipher(available = true): Cipher {
  return {
    available: () => available,
    encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString('base64')}`),
    decrypt: (data) => Buffer.from(data.toString().slice(4), 'base64').toString()
  }
}

function setup({ cipher = fakeCipher(), distribution = false } = {}) {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  const root = mkdtempSync(join(tmpdir(), 'clyde-profiles-'))
  const onChanged = vi.fn()
  const secrets = new SecretsService(db, cipher)
  const profiles = new ProfilesService(db, secrets, { dataRoot: root, distribution, onChanged })
  return { db, root, profiles, secrets, onChanged }
}

const KEY = 'sk-ant-api03-test-key-0123456789'

describe('SecretsService', () => {
  it('stores ciphertext only and decrypts on read', () => {
    const { db, profiles, secrets } = setup()
    const p = profiles.create({ name: 'Work', color: '#6366f1', auth: 'api-key', apiKey: KEY })
    const raw = db.prepare('SELECT ciphertext FROM secrets').get() as { ciphertext: Buffer }
    expect(raw.ciphertext.toString()).not.toContain(KEY)
    expect(secrets.get(p.id, 'apiKey')).toBe(KEY)
  })

  it('refuses to save when no secure storage is available', () => {
    const { db, profiles } = setup({ cipher: fakeCipher(false) })
    expect(() => profiles.create({ name: 'Work', color: '#6366f1', auth: 'api-key', apiKey: KEY })).toThrow(
      /no secure storage/
    )
    // The profile row is rolled back with the secret.
    expect(db.prepare('SELECT COUNT(*) AS n FROM profiles').get()).toEqual({ n: 0 })
  })
})

describe('ProfilesService', () => {
  it('creates, lists and updates profiles without exposing the key', () => {
    const { profiles, onChanged } = setup()
    const p = profiles.create({ name: 'Perso', label: 'PERSO', color: '#22c55e', auth: 'subscription' })
    expect(p).toMatchObject({ name: 'Perso', label: 'PERSO', auth: 'subscription', personalUse: true, usable: true })
    expect(JSON.stringify(p)).not.toMatch(/apiKey"/)

    const api = profiles.create({ name: 'API', color: '#0ea5e9', auth: 'api-key', apiKey: KEY })
    expect(api.hasApiKey).toBe(true)
    expect(JSON.stringify(profiles.list())).not.toContain(KEY)

    const renamed = profiles.update({ id: p.id, name: 'Personal', defaultModel: 'sonnet' })
    expect(renamed).toMatchObject({ name: 'Personal', label: 'PERSO', defaultModel: 'sonnet' })
    expect(onChanged).toHaveBeenCalledTimes(3)
  })

  it('validates auth and key combinations', () => {
    const { profiles } = setup()
    expect(() => profiles.create({ name: 'A', color: '#6366f1', auth: 'api-key' })).toThrow(/API key is required/)
    expect(() => profiles.create({ name: 'A', color: '#6366f1', auth: 'subscription', apiKey: KEY })).toThrow()
    expect(() => profiles.create({ name: ' ', color: '#6366f1', auth: 'subscription' })).toThrow()
    expect(() => profiles.create({ name: 'A', color: '#123456' as '#6366f1', auth: 'subscription' })).toThrow()
  })

  it('gives each profile its own config dir and deletes it with the profile', () => {
    const { profiles, secrets, root } = setup()
    const a = profiles.create({ name: 'A', color: '#6366f1', auth: 'api-key', apiKey: KEY })
    const b = profiles.create({ name: 'B', color: '#6366f1', auth: 'subscription' })
    const dirA = profiles.configDir(a.id)
    expect(dirA).not.toBe(profiles.configDir(b.id))
    expect(dirA.startsWith(root)).toBe(true)
    writeFileSync(join(dirA, '.credentials.json'), '{}')

    profiles.delete(a.id)
    expect(existsSync(dirA)).toBe(false)
    expect(existsSync(profiles.configDir(b.id))).toBe(true)
    expect(secrets.has(a.id, 'apiKey')).toBe(false)
    expect(() => profiles.get(a.id)).toThrow(/no longer exists/)
  })

  it('disables subscription profiles in a distribution build', () => {
    const { profiles } = setup({ distribution: true })
    expect(() => profiles.create({ name: 'Perso', color: '#6366f1', auth: 'subscription' })).toThrow(/disabled/)
    const api = profiles.create({ name: 'API', color: '#6366f1', auth: 'api-key', apiKey: KEY })
    expect(profiles.requireUsable(api.id).usable).toBe(true)
  })

  it('marks subscription profiles made by a personal build as unusable in a distribution build', () => {
    const personal = setup()
    const p = personal.profiles.create({ name: 'Perso', color: '#6366f1', auth: 'subscription' })
    const dist = new ProfilesService(personal.db, personal.secrets, { dataRoot: personal.root, distribution: true })
    expect(dist.get(p.id).usable).toBe(false)
    expect(() => dist.requireUsable(p.id)).toThrow(/disabled/)
  })
})

describe('API provider profiles', () => {
  it('accepts each kind with its own sign-in', () => {
    const { profiles } = setup()
    const openai = profiles.create({ kind: 'openai', name: 'OpenAI', color: '#22c55e', auth: 'api-key', apiKey: 'sk-proj-123' })
    expect(openai).toMatchObject({ kind: 'openai', auth: 'api-key', hasApiKey: true, personalUse: false, baseUrl: '' })
    const ollama = profiles.create({ kind: 'ollama', name: 'Local', color: '#64748b', auth: 'none' })
    expect(ollama).toMatchObject({ baseUrl: 'http://localhost:11434', hasApiKey: false })
    const remote = profiles.create({
      kind: 'ollama',
      name: 'GPU box',
      color: '#64748b',
      auth: 'none',
      baseUrl: 'http://gpu.lan:11434/v1/'
    })
    expect(remote.baseUrl).toBe('http://gpu.lan:11434')
    expect(profiles.update({ id: remote.id, baseUrl: 'https://ollama.example.com/' }).baseUrl).toBe('https://ollama.example.com')
  })

  it('rejects sign-in modes a kind does not support', () => {
    const { profiles } = setup()
    expect(() => profiles.create({ kind: 'openai', name: 'M', color: '#f97316', auth: 'subscription' })).toThrow(/cannot use/)
    expect(() => profiles.create({ kind: 'ollama', name: 'O', color: '#f97316', auth: 'api-key', apiKey: 'k' })).toThrow(/cannot use/)
    expect(() => profiles.create({ kind: 'anthropic', name: 'A', color: '#f97316', auth: 'api-key' })).toThrow(/API key is required/)
    expect(() =>
      profiles.create({ kind: 'ollama', name: 'O', color: '#f97316', auth: 'none', baseUrl: 'ftp://x' })
    ).toThrow()
  })

  it('creates no Claude Code folder for API accounts', () => {
    const { profiles, root } = setup()
    const p = profiles.create({ kind: 'ollama', name: 'Local', color: '#64748b', auth: 'none' })
    expect(existsSync(join(root, p.id))).toBe(false)
  })
})
