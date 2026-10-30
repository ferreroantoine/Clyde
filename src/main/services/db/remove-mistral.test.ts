import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from './database'
import { migrations } from './migrations'
import { NoticesService } from '../notices'

/** A database as version 6 left it, with a Mistral account in use. */
function v6WithMistral() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db, migrations.filter((m) => m.version <= 6))
  const profile = db.prepare(
    `INSERT INTO profiles (id, kind, name, label, color, auth, default_model, created_at, updated_at) VALUES (?, ?, ?, '', '#f97316', ?, '', ?, ?)`
  )
  profile.run('p-mistral', 'mistral', 'Le Chat pro', 'api-key', 1, 1)
  profile.run('p-openai', 'openai', 'OpenAI', 'api-key', 2, 2)
  const secret = db.prepare("INSERT INTO secrets (profile_id, name, ciphertext, updated_at) VALUES (?, 'apiKey', x'00', 1)")
  secret.run('p-mistral')
  secret.run('p-openai')
  const agent = db.prepare(
    `INSERT INTO agents (id, name, profile_id, permission_level, created_at, updated_at) VALUES (?, ?, ?, 'validate-all', 1, 1)`
  )
  agent.run('a-1', 'Reviewer', 'p-mistral')
  agent.run('a-2', 'Builder', 'p-openai')
  db.prepare(
    `INSERT INTO tasks (id, title, description, agent_id, repo_root, base_branch, branch, worktree_path, status, created_at, updated_at)
     VALUES ('t-1', 'Fix', '', 'a-1', '/r', 'main', 'clyde/fix', '/w', 'todo', 1, 1)`
  ).run()
  db.prepare(
    `INSERT INTO sessions (id, profile_id, profile_name, kind, cwd, status, started_at) VALUES ('as-1', 'p-mistral', 'Le Chat pro', 'mistral', '/r', 'stopped', 1)`
  ).run()
  return db
}

describe('migration 7: remove Mistral', () => {
  it('removes Mistral accounts, their keys and agents, and leaves a notice', () => {
    const db = v6WithMistral()
    // Up to 7 only: later migrations turn the tasks into the task list.
    migrate(db, migrations.filter((m) => m.version <= 7))
    expect(db.prepare('SELECT id FROM profiles').all()).toEqual([{ id: 'p-openai' }])
    expect(db.prepare('SELECT profile_id FROM secrets').all()).toEqual([{ profile_id: 'p-openai' }])
    expect(db.prepare('SELECT id FROM agents').all()).toEqual([{ id: 'a-2' }])
    expect(db.prepare("SELECT agent_id FROM tasks WHERE id = 't-1'").get()).toEqual({ agent_id: null })
    expect(db.prepare("SELECT COUNT(*) AS n FROM pricing WHERE kind = 'mistral'").get()).toEqual({ n: 0 })
    // History outlives the account.
    expect(db.prepare("SELECT kind FROM sessions WHERE id = 'as-1'").get()).toEqual({ kind: 'mistral' })

    const notices = new NoticesService(db)
    expect(notices.takePending()).toMatchObject([
      { type: 'mistral-removed', payload: { profiles: ['Le Chat pro'], agents: ['Reviewer'] } }
    ])
    expect(notices.takePending()).toEqual([])
  })

  it('works without foreign keys and leaves no notice when there was nothing to remove', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(new NoticesService(db).takePending()).toEqual([])
  })
})
