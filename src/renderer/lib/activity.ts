import { t, tk, tn } from '@shared/i18n'
import type { ToolItem, TranscriptItem } from './transcript'

/** What a tool call does, for its icon, its sentence and the summary of a run of actions. */
export type ToolKind = 'read' | 'write' | 'edit' | 'command' | 'search' | 'web' | 'browser' | 'screenshot' | 'image' | 'agent' | 'todo' | 'question' | 'other'

const KINDS: Record<string, ToolKind> = {
  Read: 'read',
  read_file: 'read',
  NotebookRead: 'read',
  Write: 'write',
  write_file: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  edit_file: 'edit',
  Bash: 'command',
  PowerShell: 'command',
  Monitor: 'command',
  run_command: 'command',
  Glob: 'search',
  Grep: 'search',
  list_files: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
  TodoWrite: 'todo',
  // Clyde's own task-list tool: built into its loop, and through the clyde MCP server.
  update_todos: 'todo',
  mcp__clyde__update_todos: 'todo',
  AskUserQuestion: 'question',
  ask_user: 'question',
  view_image: 'image'
}

/** `mcp__<server>__<tool>` → `<tool>`, else the name itself. */
export function mcpTool(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? { server: m[1] as string, tool: m[2] as string } : null
}

export function toolKind(name: string): ToolKind {
  const known = KINDS[name]
  if (known) return known
  const mcp = mcpTool(name)
  if (!mcp) return 'other'
  // Browser servers (Playwright, Chrome DevTools, Claude in Chrome…) by their tool names.
  if (/screenshot|take_snapshot_image|capture/i.test(mcp.tool)) return 'screenshot'
  if (/^browser_|navigate|click|hover|scroll|fill|press_key|select_option|drag|tabs?_/i.test(mcp.tool)) return 'browser'
  if (/search/i.test(mcp.tool)) return 'search'
  if (/fetch|get_page|read_page/i.test(mcp.tool)) return 'web'
  return 'other'
}

const VERBS: Record<ToolKind, string> = {
  read: tk('Reads'),
  write: tk('Writes'),
  edit: tk('Edits'),
  command: tk('Runs'),
  search: tk('Searches'),
  web: tk('Opens'),
  browser: tk('Browser'),
  screenshot: tk('Takes a screenshot'),
  image: tk('Looks at an image'),
  agent: tk('Delegates to a subagent'),
  todo: tk('Updates the to-do list'),
  question: tk('Asks you'),
  other: tk('Uses')
}

/** The sentence's verb: "Reads", "Runs", "Takes a screenshot"… */
export function toolVerb(name: string): string {
  const kind = toolKind(name)
  if (name === 'WebSearch') return t('Searches the web')
  if (name === 'list_files') return t('Lists')
  if (kind === 'browser') {
    const tool = mcpTool(name)?.tool ?? ''
    if (/navigate/i.test(tool)) return t('Opens')
    if (/click/i.test(tool)) return t('Clicks')
    if (/type|fill|press/i.test(tool)) return t('Types')
    if (/scroll/i.test(tool)) return t('Scrolls')
  }
  return t(VERBS[kind])
}

/** Tools that always stand alone: what the user must see (to-dos, questions). */
const ALONE: ReadonlySet<ToolKind> = new Set(['todo', 'question'])

/** A row of the transcript: one item, or a run of actions folded under a summary. */
export type Row = { kind: 'item'; item: TranscriptItem } | { kind: 'group'; id: string; tools: ToolItem[] }

/** Runs shorter than this stay as cards. */
export const MIN_GROUP = 3

/**
 * Folds consecutive tool calls (nothing said or thought in between) into groups. Calls that wait
 * for the user, to-do lists and questions are never folded.
 */
export function groupRows(items: readonly TranscriptItem[]): Row[] {
  const rows: Row[] = []
  let run: ToolItem[] = []
  const flush = () => {
    if (run.length >= MIN_GROUP) rows.push({ kind: 'group', id: `group-${run[0]?.toolUseId}`, tools: run })
    else for (const tool of run) rows.push({ kind: 'item', item: tool })
    run = []
  }
  for (const item of items) {
    const foldable =
      item.kind === 'tool' && !ALONE.has(toolKind(item.name)) && !item.questions && item.approval?.state !== 'pending'
    if (foldable) run.push(item)
    else {
      flush()
      rows.push({ kind: 'item', item })
    }
  }
  flush()
  return rows
}

const COUNTS: Record<Exclude<ToolKind, 'todo' | 'question'>, [string, string]> = {
  read: [tk('{count} file read'), tk('{count} files read')],
  write: [tk('{count} file written'), tk('{count} files written')],
  edit: [tk('{count} edit'), tk('{count} edits')],
  command: [tk('{count} command'), tk('{count} commands')],
  search: [tk('{count} search'), tk('{count} searches')],
  web: [tk('{count} web page'), tk('{count} web pages')],
  browser: [tk('{count} browser action'), tk('{count} browser actions')],
  screenshot: [tk('{count} screenshot'), tk('{count} screenshots')],
  image: [tk('{count} image'), tk('{count} images')],
  agent: [tk('{count} subagent'), tk('{count} subagents')],
  other: [tk('{count} other action'), tk('{count} other actions')]
}

/** "3 files read, 2 commands, 1 screenshot", in the order they first happened. */
export function summarize(tools: readonly ToolItem[]): string {
  const counts = new Map<keyof typeof COUNTS, number>()
  for (const tool of tools) {
    const kind = toolKind(tool.name)
    if (kind === 'todo' || kind === 'question') continue
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, count]) => tn(COUNTS[kind][0], COUNTS[kind][1], count)).join(', ')
}

export interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

/** The to-do list of a TodoWrite or update_todos call, or null when it is malformed. */
export function todosOf(input: Record<string, unknown>): Todo[] | null {
  const raw = input['todos']
  if (!Array.isArray(raw)) return null
  const todos: Todo[] = []
  for (const item of raw) {
    const o = item as Record<string, unknown> | null
    // TodoWrite says content / activeForm, update_todos text / active.
    const content = o?.['content'] ?? o?.['text']
    if (!o || typeof content !== 'string') return null
    const status = o['status'] === 'in_progress' || o['status'] === 'completed' ? o['status'] : 'pending'
    const active = o['activeForm'] ?? o['active']
    todos.push({ content, status, activeForm: typeof active === 'string' ? active : content })
  }
  return todos
}

/** Old and new text of an edit call, for a small diff; null when the call is not a plain edit. */
export function editOf(name: string, input: Record<string, unknown>): Array<{ before: string; after: string }> | null {
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  if (name === 'Edit' || name === 'edit_file') {
    const before = str(input['old_string']) ?? str(input['old_text']) ?? str(input['search'])
    const after = str(input['new_string']) ?? str(input['new_text']) ?? str(input['replace'])
    return before !== null && after !== null ? [{ before, after }] : null
  }
  if (name === 'MultiEdit' && Array.isArray(input['edits'])) {
    const edits = (input['edits'] as Array<Record<string, unknown>>).flatMap((e) => {
      const before = str(e['old_string'])
      const after = str(e['new_string'])
      return before !== null && after !== null ? [{ before, after }] : []
    })
    return edits.length ? edits : null
  }
  if (name === 'Write' || name === 'write_file') {
    const content = str(input['content'])
    return content !== null ? [{ before: '', after: content }] : null
  }
  return null
}
