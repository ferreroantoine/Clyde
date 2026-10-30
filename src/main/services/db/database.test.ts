import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from './database'
import { migrations } from './migrations'
import { SqliteSettingsRepository } from './settings-repo'
import { SettingsService } from '../settings'

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('no electron in tests') } } }))

const memoryDb = () => new Database(':memory:')

describe('migrate', () => {
  it('applies migrations once and records the version', () => {
    const db = memoryDb()
    const latest = Math.max(...migrations.map((m) => m.version))
    expect(migrate(db)).toBe(latest)
    expect(migrate(db)).toBe(latest)
    expect(db.pragma('user_version', { simple: true })).toBe(latest)
  })

  it('applies only pending migrations, in order', () => {
    const db = memoryDb()
    const steps = [
      { version: 2, name: 'b', sql: 'ALTER TABLE t ADD COLUMN b TEXT;' },
      { version: 1, name: 'a', sql: 'CREATE TABLE t (a TEXT);' }
    ]
    expect(migrate(db, steps.slice(1))).toBe(1)
    expect(migrate(db, steps)).toBe(2)
    const cols = (db.prepare('PRAGMA table_info(t)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(cols).toEqual(['a', 'b'])
  })

  it('rolls back a failing migration and keeps the previous version', () => {
    const db = memoryDb()
    const steps = [
      { version: 1, name: 'ok', sql: 'CREATE TABLE t (a TEXT);' },
      { version: 2, name: 'broken', sql: 'CREATE TABLE u (x TEXT); NOT SQL;' }
    ]
    expect(() => migrate(db, steps)).toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'u'").get()).toBeUndefined()
  })

  it('runs a migration step in code after its SQL, in the same transaction', () => {
    const db = memoryDb()
    const steps = [
      { version: 1, name: 'table', sql: 'CREATE TABLE t (a TEXT);' },
      {
        version: 2,
        name: 'data',
        sql: 'ALTER TABLE t ADD COLUMN b TEXT;',
        up: (d: typeof db) => d.prepare("INSERT INTO t (a, b) VALUES ('x', 'y')").run()
      },
      {
        version: 3,
        name: 'failing',
        sql: 'CREATE TABLE u (x TEXT);',
        up: () => {
          throw new Error('boom')
        }
      }
    ]
    expect(() => migrate(db, steps)).toThrow(/boom/)
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    expect(db.prepare('SELECT a, b FROM t').all()).toEqual([{ a: 'x', b: 'y' }])
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'u'").get()).toBeUndefined()
  })

  it('refuses a database created by a newer build', () => {
    const db = memoryDb()
    db.pragma('user_version = 99')
    expect(() => migrate(db)).toThrow(/newer than this build/)
  })
})

describe('SqliteSettingsRepository', () => {
  it('persists settings across service instances', () => {
    const db = memoryDb()
    migrate(db)
    new SettingsService(new SqliteSettingsRepository(db)).set('appearance.theme', 'dark')
    expect(new SettingsService(new SqliteSettingsRepository(db)).getAll().appearance.theme).toBe('dark')
  })
})
