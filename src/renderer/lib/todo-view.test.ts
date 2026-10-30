import { describe, expect, it } from 'vitest'
import type { Todo } from '@shared/todos'
import { columnsOf, OLD_DONE_MS, progressOf } from './todo-view'

const DAY = 24 * 60 * 60 * 1000
const now = 100 * DAY
const todo = (id: string, over: Partial<Todo> = {}): Todo => ({
  id,
  text: id,
  status: 'todo',
  sessionId: null,
  origin: 'user',
  active: null,
  position: 0,
  createdAt: 0,
  updatedAt: 0,
  doneAt: null,
  ...over
})

describe('columnsOf', () => {
  const list = [
    todo('b', { position: 2 }),
    todo('a', { position: 1 }),
    todo('agent', { status: 'in_progress', sessionId: 'as-1', origin: 'agent' }),
    todo('recent', { status: 'done', doneAt: now - DAY }),
    todo('newest', { status: 'done', doneAt: now - 1000 }),
    todo('old', { status: 'done', doneAt: now - OLD_DONE_MS - 1 })
  ]

  it('sorts columns and folds old done tasks', () => {
    const c = columnsOf(list, { kind: 'all' }, now)
    expect(c.todo.map((x) => x.id)).toEqual(['a', 'b'])
    expect(c.in_progress.map((x) => x.id)).toEqual(['agent'])
    expect(c.done.map((x) => x.id)).toEqual(['newest', 'recent'])
    expect(c.olderDone.map((x) => x.id)).toEqual(['old'])
  })

  it('filters on mine or one session', () => {
    expect(columnsOf(list, { kind: 'mine' }, now).in_progress).toEqual([])
    const session = columnsOf(list, { kind: 'session', sessionId: 'as-1' }, now)
    expect([...session.todo, ...session.in_progress, ...session.done].map((x) => x.id)).toEqual(['agent'])
  })
})

describe('progressOf', () => {
  it('counts and finds the task in progress', () => {
    expect(
      progressOf([
        { text: 'A', status: 'completed' },
        { text: 'B', status: 'in_progress', active: 'Doing B' },
        { text: 'C', status: 'pending' }
      ])
    ).toEqual({ done: 1, total: 3, current: { text: 'B', status: 'in_progress', active: 'Doing B' } })
    expect(progressOf([])).toBeNull()
    expect(progressOf(null)).toBeNull()
  })
})
