import type { Db } from './database'
import type { SettingsRepository } from '../settings'
import { createLogger } from '../../logger'

const log = createLogger('settings-repo')

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: Db) {}

  loadAll(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    const out: Record<string, unknown> = {}
    for (const { key, value } of rows) {
      try {
        out[key] = JSON.parse(value)
      } catch {
        log.warn(`ignoring unreadable value for setting "${key}"`)
      }
    }
    return out
  }

  save(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), Date.now())
  }

  remove(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  }
}
