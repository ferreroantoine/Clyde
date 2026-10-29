import type { Db } from './database'

export interface Migration {
  version: number
  name: string
  sql: string
  /** Runs after `sql`, in the same transaction, for steps that need to read data first. */
  up?: (db: Db) => void
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
  },
  {
    version: 5,
    name: 'agent definitions and tasks',
    sql: `
      CREATE TABLE agents (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        model            TEXT NOT NULL DEFAULT '',
        system_prompt    TEXT NOT NULL DEFAULT '',
        permission_level TEXT NOT NULL,
        mcp_tools        TEXT NOT NULL DEFAULT '[]',
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL
      );
      CREATE TABLE tasks (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        description   TEXT NOT NULL,
        agent_id      TEXT REFERENCES agents(id) ON DELETE SET NULL,
        repo_root     TEXT NOT NULL,
        base_branch   TEXT NOT NULL,
        branch        TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        status        TEXT NOT NULL,
        outcome       TEXT,
        session_id    TEXT,
        note          TEXT,
        merge_commit  TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX tasks_repo ON tasks(repo_root, status);
    `
  },
  {
    version: 6,
    name: 'history, usage, rate limits and prices',
    sql: `
      -- No foreign keys: history outlives the accounts it was made with.
      CREATE TABLE sessions (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT NOT NULL,
        profile_name   TEXT NOT NULL,
        kind           TEXT NOT NULL,
        model          TEXT NOT NULL DEFAULT '',
        agent_id       TEXT,
        task_id        TEXT,
        title          TEXT,
        cwd            TEXT NOT NULL,
        status         TEXT NOT NULL,
        started_at     INTEGER NOT NULL,
        ended_at       INTEGER,
        turns          INTEGER NOT NULL DEFAULT 0,
        input_tokens   INTEGER NOT NULL DEFAULT 0,
        output_tokens  INTEGER NOT NULL DEFAULT 0,
        cost_usd       REAL NOT NULL DEFAULT 0,
        cost_estimated INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX sessions_started ON sessions(started_at);
      -- The transcript, minus streaming deltas; replayed by the history view.
      CREATE TABLE session_events (
        session_id TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        at         INTEGER NOT NULL,
        event      TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
      CREATE TABLE usage_events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id    TEXT NOT NULL,
        profile_id    TEXT NOT NULL,
        model         TEXT NOT NULL,
        at            INTEGER NOT NULL,
        input_tokens  INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        -- NULL when no price is known for the model.
        cost_usd      REAL,
        estimated     INTEGER NOT NULL
      );
      CREATE INDEX usage_at ON usage_events(at);
      CREATE TABLE rate_limit_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id  TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        at          INTEGER NOT NULL,
        status      TEXT NOT NULL,
        utilization REAL,
        resets_at   INTEGER,
        limit_type  TEXT
      );
      CREATE INDEX rate_limit_profile ON rate_limit_events(profile_id, at);
      CREATE TABLE pricing (
        id              TEXT PRIMARY KEY,
        kind            TEXT NOT NULL,
        model_prefix    TEXT NOT NULL,
        input_per_mtok  REAL NOT NULL,
        output_per_mtok REAL NOT NULL,
        source          TEXT NOT NULL,
        updated_at      INTEGER NOT NULL,
        UNIQUE (kind, model_prefix)
      );
      -- List prices from platform.claude.com/docs/en/about-claude/pricing and mistral.ai/pricing, October 2026.
      INSERT INTO pricing (id, kind, model_prefix, input_per_mtok, output_per_mtok, source, updated_at) VALUES
        ('seed-claude-fable-5-1', 'anthropic', 'claude-fable-5-1', 10, 50, 'seed', 0),
        ('seed-claude-fable-5', 'anthropic', 'claude-fable-5', 10, 50, 'seed', 0),
        ('seed-claude-mythos-5', 'anthropic', 'claude-mythos-5', 10, 50, 'seed', 0),
        ('seed-claude-opus-5-5', 'anthropic', 'claude-opus-5-5', 4, 20, 'seed', 0),
        ('seed-claude-opus-5', 'anthropic', 'claude-opus-5', 5, 25, 'seed', 0),
        ('seed-claude-opus-4-8', 'anthropic', 'claude-opus-4-8', 5, 25, 'seed', 0),
        ('seed-claude-opus-4-7', 'anthropic', 'claude-opus-4-7', 5, 25, 'seed', 0),
        ('seed-claude-opus-4-6', 'anthropic', 'claude-opus-4-6', 5, 25, 'seed', 0),
        ('seed-claude-opus-4-5', 'anthropic', 'claude-opus-4-5', 5, 25, 'seed', 0),
        ('seed-claude-opus-4-1', 'anthropic', 'claude-opus-4-1', 15, 75, 'seed', 0),
        ('seed-claude-opus-4', 'anthropic', 'claude-opus-4', 15, 75, 'seed', 0),
        ('seed-claude-sonnet-5-5', 'anthropic', 'claude-sonnet-5-5', 2, 10, 'seed', 0),
        ('seed-claude-sonnet-5', 'anthropic', 'claude-sonnet-5', 2, 10, 'seed', 0),
        ('seed-claude-sonnet-4-6', 'anthropic', 'claude-sonnet-4-6', 3, 15, 'seed', 0),
        ('seed-claude-sonnet-4-5', 'anthropic', 'claude-sonnet-4-5', 3, 15, 'seed', 0),
        ('seed-claude-sonnet-4', 'anthropic', 'claude-sonnet-4', 3, 15, 'seed', 0),
        ('seed-claude-haiku-5-5', 'anthropic', 'claude-haiku-5-5', 0.1, 0.5, 'seed', 0),
        ('seed-claude-haiku-4-5', 'anthropic', 'claude-haiku-4-5', 1, 5, 'seed', 0),
        ('seed-claude-3-5-haiku', 'anthropic', 'claude-3-5-haiku', 0.8, 4, 'seed', 0),
        ('seed-mistral-large', 'mistral', 'mistral-large', 0.5, 1.5, 'seed', 0);
    `
  }
]
