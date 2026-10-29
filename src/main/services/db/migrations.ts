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
  },
  {
    version: 2,
    name: 'profiles and secrets',
    sql: `
      CREATE TABLE profiles (
        id            TEXT PRIMARY KEY,
        kind          TEXT NOT NULL,
        name          TEXT NOT NULL,
        label         TEXT NOT NULL DEFAULT '',
        color         TEXT NOT NULL,
        auth          TEXT NOT NULL,
        default_model TEXT NOT NULL DEFAULT '',
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      -- Values are safeStorage ciphertext. Plain text never reaches this table.
      CREATE TABLE secrets (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, name)
      );
    `
  }
]
