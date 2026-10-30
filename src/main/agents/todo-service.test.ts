import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from '../services/db/database'
import { migrations } from '../services/db/migrations'
import { reconcile, TodoService, type TodoRow } from './todo-service'

const row = (over: Partial<TodoRow>): TodoRow => ({
  id: 'r1',
  root: '/p',
  text: 'Task',
  status: 'todo',
  session_id: 's',
  origin: 'agent',
  item_key: null,
  active: null,
  position: 1,
  created_at: 0,
  updated_at: 0,
  done_at: null,
  ...over
})

describe('reconcile', () => {
  it('matches by key, then by text, and adds the rest', () => {
    const existing = [row({ id: 'k', item_key: 'a', text: 'Old wording' }), row({ id: 't', text: 'Run the tests' })]
    const plan = reconcile(
      existing,
      [
        { key: 'a', text: 'New wording', status: 'in_progress', active: 'Doing it' },
        { text: 'run the tests.', status: 'pending' },
        { text: 'Write docs', status: 'pending' }
      ],
      1,
      100
    )
    expect(plan.update).toEqual([
      { id: 'k', patch: { text: 'New wording', status: 'in_progress', done_at: null, active: 'Doing it' } },
      { id: 't', patch: { text: 'run the tests.', position: 1.001 } }
    ])
    expect(plan.insert).toEqual([{ text: 'Write docs', status: 'todo', item_key: null, active: null, position: 1.002, done_at: null }])
    expect(plan.remove).toEqual([])
  })

  it('moves a task to Done with its date', () => {
    const plan = reconcile([row({ id: 'x', status: 'in_progress', active: 'Working' })], [{ text: 'Task', status: 'completed' }], 1, 42)
    expect(plan.update).toEqual([{ id: 'x', patch: { status: 'done', done_at: 42, active: null } }])
  })

  it('drops what the agent dropped, but keeps done tasks and the user’s own', () => {
    const plan = reconcile(
      [row({ id: 'gone' }), row({ id: 'done', text: 'Finished', status: 'done', done_at: 5 }), row({ id: 'mine', text: 'Handed over', origin: 'user', active: 'x', status: 'in_progress' })],
      [],
      1,
      100
    )
    expect(plan.remove).toEqual(['gone'])
    expect(plan.update).toEqual([{ id: 'mine', patch: { active: null } }])
  })

  it('changes nothing for the same list', () => {
    const plan = reconcile([row({ id: 'same', position: 1 })], [{ text: 'Task', status: 'pending' }], 1, 9)
    expect(plan).toEqual({ insert: [], update: [], remove: [], adopt: [] })
  })

  it('takes over the user’s unassigned task of the same text, and leaves the others alone', () => {
    const mine = row({ id: 'mine', session_id: null, origin: 'user', text: 'Add a README' })
    const other = row({ id: 'other', session_id: null, origin: 'user', text: 'Something else' })
    const plan = reconcile([], [{ text: 'add a readme', status: 'in_progress' }], 1, 5, [mine, other])
    expect(plan.adopt).toEqual(['mine'])
    expect(plan.insert).toEqual([])
    expect(plan.remove).toEqual([])
    expect(plan.update).toEqual([{ id: 'mine', patch: { text: 'add a readme', status: 'in_progress', done_at: null } }])
  })
})

function service(root = '/project') {
  const db = new Database(':memory:')
  migrate(db)
  const onChanged = vi.fn()
  let now = 1000
  const todos = new TodoService(db, { root: () => root, sessionRoot: (id) => (id.startsWith('as-chat') ? null : root), onChanged, now: () => now++ })
  return { db, todos, onChanged }
}

describe('TodoService', () => {
  it('follows an agent’s list as it changes', () => {
    const { todos, onChanged } = service()
    todos.applyList('as-1', [
      { text: 'Read', status: 'in_progress', active: 'Reading' },
      { text: 'Fix', status: 'pending' }
    ])
    expect(todos.list().map((t) => [t.text, t.status, t.active, t.sessionId])).toEqual([
      ['Read', 'in_progress', 'Reading', 'as-1'],
      ['Fix', 'todo', null, 'as-1']
    ])
    todos.applyList('as-1', [
      { text: 'Read', status: 'completed' },
      { text: 'Fix', status: 'in_progress', active: 'Fixing' }
    ])
    const [read, fix] = todos.list()
    expect(read?.status).toBe('done')
    expect(read?.doneAt).not.toBeNull()
    expect(fix?.active).toBe('Fixing')
    todos.applyList('as-1', [{ text: 'Read', status: 'completed' }])
    expect(todos.list().map((t) => t.text)).toEqual(['Read'])
    expect(onChanged).toHaveBeenCalledTimes(3)
  })

  it('ignores chat sessions', () => {
    const { todos } = service()
    todos.applyList('as-chat-1', [{ text: 'x', status: 'pending' }])
    expect(todos.list()).toEqual([])
  })

  it('creates, moves, edits, hands over and deletes the user’s tasks', () => {
    const { todos } = service()
    const a = todos.create({ text: 'A' })
    const b = todos.create({ text: 'B' })
    expect(a.origin).toBe('user')
    // B before A in To do, then A to Done.
    todos.update({ id: b.id, beforeId: a.id })
    expect(todos.list().map((t) => t.text)).toEqual(['B', 'A'])
    const done = todos.update({ id: a.id, status: 'done' })
    expect(done.doneAt).not.toBeNull()
    expect(todos.update({ id: a.id, status: 'todo' }).doneAt).toBeNull()
    expect(todos.update({ id: a.id, text: 'A2' }).text).toBe('A2')
    // Handed to a session: the agent's list takes it over by its text, and keeps it if it drops it.
    todos.assign(b.id, 'as-2')
    todos.applyList('as-2', [{ text: 'b', status: 'in_progress', active: 'On it' }])
    expect(todos.list().find((t) => t.id === b.id)).toMatchObject({ status: 'in_progress', active: 'On it', sessionId: 'as-2', origin: 'user' })
    todos.applyList('as-2', [])
    expect(todos.list().find((t) => t.id === b.id)).toMatchObject({ status: 'in_progress', active: null })
    todos.delete(b.id)
    expect(todos.list().map((t) => t.text)).toEqual(['A2'])
  })

  it('keeps each project’s tasks apart', () => {
    const { db, todos } = service('/one')
    todos.create({ text: 'In one' })
    const other = new TodoService(db, { root: () => '/two', sessionRoot: () => '/two', onChanged: () => undefined })
    expect(other.list()).toEqual([])
  })
})

describe('migration 18', () => {
  it('turns board tasks into tasks of the list and tells about worktrees left', () => {
    const db = new Database(':memory:')
    migrate(
      db,
      migrations.filter((m) => m.version <= 17)
    )
    const leftover = mkdtempSync(join(tmpdir(), 'clyde-wt-left-'))
    const insert = db.prepare(
      `INSERT INTO tasks (id, title, description, agent_id, repo_root, base_branch, branch, worktree_path, status, outcome, session_id, position, created_at, updated_at)
       VALUES (?, ?, 'd', NULL, '/repo', 'main', ?, ?, ?, ?, NULL, ?, 1, 2)`
    )
    insert.run('00000000-0000-4000-8000-000000000001', 'Todo task', 'clyde/a', join(leftover, 'gone'), 'todo', null, 1)
    insert.run('00000000-0000-4000-8000-000000000002', 'Review task', 'clyde/b', leftover, 'review', null, 2)
    insert.run('00000000-0000-4000-8000-000000000003', 'Merged task', 'clyde/c', leftover, 'done', 'merged', 3)
    migrate(db)
    const rows = db.prepare('SELECT text, status, done_at FROM todos ORDER BY position').all()
    expect(rows).toEqual([
      { text: 'Todo task', status: 'todo', done_at: null },
      { text: 'Review task', status: 'in_progress', done_at: null },
      { text: 'Merged task', status: 'done', done_at: 2 }
    ])
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'tasks'").get()).toBeUndefined()
    const notice = db.prepare('SELECT type, payload FROM app_notices').get() as { type: string; payload: string }
    expect(notice.type).toBe('task-worktrees-left')
    // Only the unmerged task whose folder still exists.
    expect(JSON.parse(notice.payload).worktrees).toEqual([{ path: leftover, branch: 'clyde/b', repo: '/repo' }])
  })
})
