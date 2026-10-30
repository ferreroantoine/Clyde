import { describe, expect, it } from 'vitest'
import { editOf, groupRows, summarize, todosOf, toolKind, toolVerb } from './activity'
import type { ToolItem, TranscriptItem } from './transcript'

const tool = (id: string, name: string, extra: Partial<ToolItem> = {}): ToolItem => ({
  kind: 'tool',
  toolUseId: id,
  name,
  input: {},
  parentToolUseId: null,
  result: null,
  denied: null,
  approval: null,
  questions: null,
  ...extra
})

describe('toolKind', () => {
  it('knows the built-in tools and reads browser servers by their tool names', () => {
    expect(toolKind('Read')).toBe('read')
    expect(toolKind('run_command')).toBe('command')
    expect(toolKind('mcp__playwright__browser_take_screenshot')).toBe('screenshot')
    expect(toolKind('mcp__playwright__browser_navigate')).toBe('browser')
    expect(toolKind('mcp__github__search_issues')).toBe('search')
    expect(toolKind('mcp__db__query')).toBe('other')
    expect(toolVerb('mcp__playwright__browser_click')).toBe('Clicks')
    expect(toolVerb('Bash')).toBe('Runs')
  })
})

describe('groupRows', () => {
  it('folds three or more actions in a row, never thinking, to-dos or calls waiting for the user', () => {
    const items: TranscriptItem[] = [
      { kind: 'user', id: 'u', text: 'go' },
      tool('a', 'Read'),
      tool('b', 'Grep'),
      tool('c', 'Bash'),
      { kind: 'thinking', key: 'th', text: 'hmm', final: true },
      tool('d', 'Read'),
      tool('e', 'Read'),
      tool('f', 'TodoWrite'),
      tool('g', 'Edit'),
      tool('h', 'Edit'),
      tool('i', 'Bash', { approval: { requestId: 'r', reason: '', state: 'pending' } })
    ]
    const rows = groupRows(items)
    expect(rows.map((r) => (r.kind === 'group' ? `group:${r.tools.map((t) => t.toolUseId).join('')}` : r.item.kind === 'tool' ? r.item.toolUseId : r.item.kind))).toEqual([
      'user',
      'group:abc',
      'thinking',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i'
    ])
  })

  it('sums a run up by kind', () => {
    expect(summarize([tool('a', 'Read'), tool('b', 'Read'), tool('c', 'Bash'), tool('d', 'mcp__pw__browser_take_screenshot')])).toBe(
      '2 files read, 1 command, 1 screenshot'
    )
  })
})

describe('tool inputs', () => {
  it('reads to-do lists and edits', () => {
    expect(todosOf({ todos: [{ content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' }, { content: 'Ship' }] })).toEqual([
      { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
      { content: 'Ship', status: 'pending', activeForm: 'Ship' }
    ])
    expect(todosOf({ todos: 'nope' })).toBeNull()
    expect(editOf('Edit', { old_string: 'a', new_string: 'b' })).toEqual([{ before: 'a', after: 'b' }])
    expect(editOf('edit_file', { old_text: 'a', new_text: 'b' })).toEqual([{ before: 'a', after: 'b' }])
    expect(editOf('Write', { content: 'x' })).toEqual([{ before: '', after: 'x' }])
    expect(editOf('Read', {})).toBeNull()
  })
})
