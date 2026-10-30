import type { AgentEvent, AgentEventEnvelope, AgentQuestion, AgentSessionInfo, ApprovalDecision, ToolImage } from '@shared/agent'
import { t, tn } from '@shared/i18n'

export interface Approval {
  requestId: string
  reason: string
  state: 'pending' | ApprovalDecision | 'cancelled'
}

/** Multiple-choice questions a tool call waits on; `answers` is null when skipped or cancelled. */
export interface Questions {
  requestId: string
  questions: AgentQuestion[]
  state: 'pending' | 'answered' | 'skipped'
  answers: Record<string, string> | null
}

export type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; key: string; text: string; final: boolean }
  /** The model's reasoning between actions; `final` once the block is complete. */
  | { kind: 'thinking'; key: string; text: string; final: boolean }
  | {
      kind: 'tool'
      toolUseId: string
      name: string
      input: Record<string, unknown>
      parentToolUseId: string | null
      result: { content: string; isError: boolean; images: ToolImage[] } | null
      denied: string | null
      approval: Approval | null
      questions: Questions | null
    }
  | {
      kind: 'turn'
      id: string
      isError: boolean
      subtype: string
      errors: string[]
      costUsd: number | null
      inputTokens: number
      outputTokens: number
      durationMs: number
    }
  | { kind: 'error'; id: string; message: string }
  /** A quiet line in the transcript, e.g. "earlier turns summarized". */
  | { kind: 'note'; id: string; text: string }

export type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>

export interface RateLimit {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  resetsAt: number | null
  utilization: number | null
  limitType: string | null
}

export interface SessionView {
  info: AgentSessionInfo
  items: TranscriptItem[]
  lastSeq: number
  cliVersion: string | null
  rateLimit: RateLimit | null
  totals: { costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }
  /** Size of the conversation after the last turn, and the model's window when known. */
  context: { tokens: number; window: number | null } | null
  /** Whether "Resume" can bring it back once it ended. */
  resumable: boolean
}

export function emptyView(info: AgentSessionInfo): SessionView {
  return {
    info,
    items: [],
    lastSeq: 0,
    cliVersion: null,
    rateLimit: null,
    totals: { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    context: null,
    resumable: true
  }
}

function updateTool(items: TranscriptItem[], toolUseId: string, patch: (t: ToolItem) => ToolItem): TranscriptItem[] | null {
  const index = items.findIndex((i) => i.kind === 'tool' && i.toolUseId === toolUseId)
  if (index < 0) return null
  const next = items.slice()
  next[index] = patch(items[index] as ToolItem)
  return next
}

function newTool(toolUseId: string, name: string, input: Record<string, unknown>): ToolItem {
  return { kind: 'tool', toolUseId, name, input, parentToolUseId: null, result: null, denied: null, approval: null, questions: null }
}

/** Folds one event into the session view. Pure; duplicate or stale events are ignored by `seq`. */
export function applyEvent(view: SessionView, envelope: AgentEventEnvelope): SessionView {
  if (envelope.seq <= view.lastSeq) return view
  const next = reduce({ ...view, lastSeq: envelope.seq }, envelope.event, envelope.seq)
  return next
}

function reduce(view: SessionView, event: AgentEvent, seq: number): SessionView {
  const { items } = view
  switch (event.type) {
    case 'status':
      return { ...view, info: { ...view.info, status: event.status } }
    case 'init':
      // Sessions recorded before the rename carry `claudeCodeVersion`.
      return {
        ...view,
        cliVersion: event.cliVersion ?? (event as { claudeCodeVersion?: string }).claudeCodeVersion ?? null,
        info: { ...view.info, model: event.model || view.info.model }
      }
    case 'user':
      return { ...view, items: [...items, { kind: 'user', id: event.id, text: event.text }] }
    case 'text_delta':
    case 'text': {
      const index = items.findIndex((i) => i.kind === 'text' && i.key === event.key)
      if (index < 0) {
        return { ...view, items: [...items, { kind: 'text', key: event.key, text: event.text, final: event.type === 'text' }] }
      }
      const current = items[index] as Extract<TranscriptItem, { kind: 'text' }>
      if (current.final && event.type === 'text_delta') return view
      const next = items.slice()
      next[index] = {
        ...current,
        text: event.type === 'text' ? event.text : current.text + event.text,
        final: event.type === 'text'
      }
      return { ...view, items: next }
    }
    case 'tool_call': {
      const patched = updateTool(items, event.toolUseId, (t) => ({ ...t, name: event.name, input: event.input }))
      if (patched) return { ...view, items: patched }
      return {
        ...view,
        items: [...items, { ...newTool(event.toolUseId, event.name, event.input), parentToolUseId: event.parentToolUseId }]
      }
    }
    case 'thinking_delta':
    case 'thinking': {
      const index = items.findIndex((i) => i.kind === 'thinking' && i.key === event.key)
      if (index < 0) {
        return { ...view, items: [...items, { kind: 'thinking', key: event.key, text: event.text, final: event.type === 'thinking' }] }
      }
      const current = items[index] as Extract<TranscriptItem, { kind: 'thinking' }>
      if (current.final && event.type === 'thinking_delta') return view
      const next = items.slice()
      next[index] = { ...current, text: event.type === 'thinking' ? event.text : current.text + event.text, final: event.type === 'thinking' }
      return { ...view, items: next }
    }
    case 'tool_result': {
      const result = { content: event.content, isError: event.isError, images: (event.images ?? []).filter((i) => i.id) }
      const patched = updateTool(items, event.toolUseId, (t) => ({ ...t, result }))
      return patched ? { ...view, items: patched } : view
    }
    case 'approval_request': {
      const approval: Approval = { requestId: event.requestId, reason: event.reason, state: 'pending' }
      const patched = updateTool(items, event.toolUseId, (t) => ({ ...t, approval }))
      if (patched) return { ...view, items: patched }
      // Claude Code can ask about a call it has not shown yet.
      return { ...view, items: [...items, { ...newTool(event.toolUseId, event.toolName, event.input), approval }] }
    }
    case 'approval_resolved': {
      const index = items.findIndex((i) => i.kind === 'tool' && i.approval?.requestId === event.requestId)
      if (index < 0) return view
      const tool = items[index] as ToolItem
      const next = items.slice()
      next[index] = { ...tool, approval: tool.approval && { ...tool.approval, state: event.decision } }
      return { ...view, items: next }
    }
    case 'question_request': {
      const questions: Questions = { requestId: event.requestId, questions: event.questions, state: 'pending', answers: null }
      const patched = updateTool(items, event.toolUseId, (t) => ({ ...t, questions }))
      if (patched) return { ...view, items: patched }
      return { ...view, items: [...items, { ...newTool(event.toolUseId, 'AskUserQuestion', {}), questions }] }
    }
    case 'question_resolved': {
      const index = items.findIndex((i) => i.kind === 'tool' && i.questions?.requestId === event.requestId)
      if (index < 0) return view
      const tool = items[index] as ToolItem
      const next = items.slice()
      next[index] = {
        ...tool,
        questions: tool.questions && { ...tool.questions, state: event.answers ? 'answered' : 'skipped', answers: event.answers }
      }
      return { ...view, items: next }
    }
    case 'tool_output':
      // Shown in the agent's read-only terminal, not in the transcript.
      return view
    case 'permission_denied': {
      const patched = updateTool(items, event.toolUseId, (t) => ({ ...t, denied: event.reason }))
      return patched ? { ...view, items: patched } : view
    }
    case 'turn_end':
      return {
        ...view,
        items: [...items, { kind: 'turn', id: `turn-${seq}`, ...withoutType(event) }],
        totals: {
          costUsd: view.totals.costUsd + (event.costUsd ?? 0),
          inputTokens: view.totals.inputTokens + event.inputTokens,
          outputTokens: view.totals.outputTokens + event.outputTokens,
          cacheReadTokens: view.totals.cacheReadTokens + (event.cacheReadTokens ?? 0)
        },
        context: event.contextTokens ? { tokens: event.contextTokens, window: event.contextWindow ?? view.context?.window ?? null } : view.context
      }
    case 'rate_limit':
      return { ...view, rateLimit: withoutType(event) }
    case 'error':
      return { ...view, items: [...items, { kind: 'error', id: `error-${seq}`, message: event.message }] }
    case 'context_summarized':
      return {
        ...view,
        items: [...items, { kind: 'note', id: `note-${seq}`, text: tn('{count} earlier turn summarized to save context.', '{count} earlier turns summarized to save context.', event.turns) }]
      }
    case 'context_compacted':
      return { ...view, items: [...items, { kind: 'note', id: `note-${seq}`, text: t('The conversation was compacted.') }], context: view.context ? { ...view.context, tokens: 0 } : null }
    case 'session_resumed':
      return {
        ...view,
        items: [
          ...items,
          {
            kind: 'note',
            id: `note-${seq}`,
            text: event.fresh ? t('Session resumed. The agent could not reopen its conversation: it got the end of this transcript instead.') : t('Session resumed.')
          }
        ]
      }
  }
}

function withoutType<T extends { type: string }>(event: T): Omit<T, 'type'> {
  const { type: _type, ...rest } = event
  return rest
}

/** True while a tool runs: no result yet, not denied, not waiting for the user. */
export function toolState(tool: ToolItem, sessionEnded: boolean): 'running' | 'done' | 'error' | 'denied' | 'awaiting' {
  if (tool.approval?.state === 'pending' || tool.questions?.state === 'pending') return 'awaiting'
  // Skipped questions come back as a refused call, but nothing went wrong.
  if (tool.questions) return 'done'
  if (tool.denied || tool.approval?.state === 'deny' || tool.approval?.state === 'cancelled') return 'denied'
  if (tool.result) return tool.result.isError ? 'error' : 'done'
  return sessionEnded ? 'error' : 'running'
}

/** One-line summary of a tool call for its collapsed card. */
export function describeTool(name: string, input: Record<string, unknown>, cwd: string): string {
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  const relative = (p: string) => {
    const norm = p.replace(/\\/g, '/')
    const root = cwd.replace(/\\/g, '/').replace(/\/$/, '')
    return norm.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? norm.slice(root.length + 1) : norm
  }
  switch (name) {
    case 'Bash':
    case 'PowerShell':
    case 'Monitor':
    case 'run_command':
      return str('command')
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return relative(str('path'))
    case 'list_files':
      return str('path') ? relative(str('path')) : '.'
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return relative(str('file_path'))
    case 'NotebookEdit':
      return relative(str('notebook_path'))
    case 'Glob':
    case 'Grep':
      return [str('pattern'), str('path') && `in ${relative(str('path'))}`].filter(Boolean).join(' ')
    case 'WebFetch':
      return str('url')
    case 'WebSearch':
      return str('query')
    case 'Agent':
    case 'Task':
      return str('description') || str('prompt')
    case 'TodoWrite':
      return t('Update the to-do list')
    case 'AskUserQuestion':
    case 'ask_user': {
      const questions = Array.isArray(input['questions']) ? (input['questions'] as Array<{ question?: unknown }>) : []
      return typeof questions[0]?.question === 'string' ? questions[0].question : t('Questions for you')
    }
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string')
      return typeof first === 'string' ? first : ''
    }
  }
}
