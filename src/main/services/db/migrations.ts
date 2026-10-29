export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * Append-only list. Never edit a migration once released; add a new one.
 * The applied version is stored in `PRAGMA user_version`.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'settings',
    sql: `
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `
  }
]
