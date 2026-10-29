import Database from 'better-sqlite3'
import { migrations as defaultMigrations, type Migration } from './migrations'

export type Db = Database.Database

export function openDatabase(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 3000')
  return db
}

/** Applies pending migrations in order, each in its own transaction. Returns the resulting version. */
export function migrate(db: Db, migrations: Migration[] = defaultMigrations): number {
  const current = db.pragma('user_version', { simple: true }) as number
  const pending = [...migrations].sort((a, b) => a.version - b.version).filter((m) => m.version > current)
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0)
  if (current > latest) {
    throw new Error(`Database version ${current} is newer than this build (${latest}). Update Atelier.`)
  }
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql)
      m.up?.(db)
      db.pragma(`user_version = ${m.version}`)
    })()
  }
  return pending.at(-1)?.version ?? current
}
