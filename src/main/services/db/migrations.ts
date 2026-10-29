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
  },
  {
    version: 3,
    name: 'profile base url',
    sql: `ALTER TABLE profiles ADD COLUMN base_url TEXT NOT NULL DEFAULT '';`
  },
  {
    version: 4,
    name: 'mcp servers',
    sql: `
      CREATE TABLE mcp_servers (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL UNIQUE,
        transport  TEXT NOT NULL,
        command    TEXT NOT NULL DEFAULT '',
        args_json  TEXT NOT NULL DEFAULT '[]',
        url        TEXT NOT NULL DEFAULT '',
        -- safeStorage ciphertext of {"env": {...}, "headers": {...}}; NULL when both are empty.
        secrets    BLOB,
        env_keys   TEXT NOT NULL DEFAULT '[]',
        header_keys TEXT NOT NULL DEFAULT '[]',
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `
  }
]
