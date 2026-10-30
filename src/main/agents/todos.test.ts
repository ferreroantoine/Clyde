import { describe, expect, it } from 'vitest'
import { MCP_UPDATE_TODOS, parseTodoList, todoReflex, todosFromCodexPlan, todosFromToolCall } from './todos'

describe('todosFromToolCall', () => {
  it('reads Claude Code TodoWrite', () => {
    const items = todosFromToolCall('TodoWrite', {
      todos: [
        { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
        { content: 'Fix the bug', status: 'in_progress', activeForm: 'Fixing the bug' },
        { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' }
      ]
    })
    expect(items).toEqual([
      { text: 'Read the code', status: 'completed', active: 'Reading the code' },
      { text: 'Fix the bug', status: 'in_progress', active: 'Fixing the bug' },
      { text: 'Run the tests', status: 'pending', active: 'Running the tests' }
    ])
  })

  it('reads update_todos, built in or through the clyde MCP server, with ids', () => {
    const input = { todos: [{ id: 'a', text: 'Write the parser', status: 'in_progress', active: 'Writing it' }] }
    const expected = [{ key: 'a', text: 'Write the parser', status: 'in_progress', active: 'Writing it' }]
    expect(todosFromToolCall('update_todos', input)).toEqual(expected)
    expect(todosFromToolCall(MCP_UPDATE_TODOS, input)).toEqual(expected)
  })

  it('ignores other tools and bad entries', () => {
    expect(todosFromToolCall('Read', { todos: [] })).toBeNull()
    expect(todosFromToolCall('TodoWrite', { todos: 'nope' })).toBeNull()
    expect(parseTodoList([{ content: '', status: 'pending' }, { content: 'x', status: 'weird' }, null, { content: 'ok', status: 'done' }])).toEqual([
      { text: 'ok', status: 'completed' }
    ])
  })
})

describe('todosFromCodexPlan', () => {
  it('maps Codex statuses', () => {
    expect(
      todosFromCodexPlan([
        { step: 'Inspect', status: 'completed' },
        { step: 'Patch', status: 'inProgress' },
        { step: 'Verify', status: 'pending' }
      ])
    ).toEqual([
      { text: 'Inspect', status: 'completed' },
      { text: 'Patch', status: 'in_progress' },
      { text: 'Verify', status: 'pending' }
    ])
  })
})

describe('todoReflex', () => {
  it('names the tool each provider has', () => {
    expect(todoReflex('claude-code')).toContain('mcp__clyde__update_todos')
    expect(todoReflex('codex')).toContain('update_plan')
    expect(todoReflex('antigravity')).toContain('clyde MCP server')
    expect(todoReflex('ollama')).toContain('update_todos')
  })
})
