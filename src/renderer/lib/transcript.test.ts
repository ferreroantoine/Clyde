import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentSessionInfo } from '@shared/agent'
import { applyEvent, describeTool, emptyView, toolState, type SessionView, type ToolItem } from './transcript'

const info: AgentSessionInfo = {
  id: 'as-1',
  profileId: 'p1',
  kind: 'claude-code',
  model: '',
  permissionLevel: 'validate-all',
  cwd: 'C:\\repo',
  mcpTools: [],
  agentId: null,
  taskId: null,
  status: 'idle',
  createdAt: 0
}

function play(events: AgentEvent[], start: SessionView = emptyView(info)): SessionView {
  return events.reduce((view, event, i) => applyEvent(view, { sessionId: 'as-1', seq: start.lastSeq + i + 1, event }), start)
}

describe('applyEvent', () => {
  it('streams text, then replaces it with the complete block', () => {
    const view = play([
      { type: 'user', id: 'u1', text: 'hi' },
      { type: 'text_delta', key: 'm1:0', text: 'Hel' },
      { type: 'text_delta', key: 'm1:0', text: 'lo' },
      { type: 'text', key: 'm1:0', text: 'Hello!' },
      { type: 'text_delta', key: 'm1:0', text: ' late' }
    ])
    expect(view.items).toEqual([
      { kind: 'user', id: 'u1', text: 'hi' },
      { kind: 'text', key: 'm1:0', text: 'Hello!', final: true }
    ])
  })

  it('attaches results, approvals and denials to their tool call', () => {
    let view = play([
      { type: 'tool_call', toolUseId: 't1', name: 'Bash', input: { command: 'npm test' }, parentToolUseId: null },
      { type: 'approval_request', requestId: 'r1', toolUseId: 't1', toolName: 'Bash', input: {}, reason: 'Shell commands need your approval' }
    ])
    const tool = () => view.items[0] as ToolItem
    expect(toolState(tool(), false)).toBe('awaiting')
    view = play([{ type: 'approval_resolved', requestId: 'r1', decision: 'allow-once' }], view)
    expect(toolState(tool(), false)).toBe('running')
    view = play([{ type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false }], view)
    expect(tool()).toMatchObject({ result: { content: 'ok', isError: false }, approval: { state: 'allow-once' } })
    expect(toolState(tool(), false)).toBe('done')

    view = play([
      { type: 'tool_call', toolUseId: 't2', name: 'Write', input: { file_path: '/etc/x' }, parentToolUseId: null },
      { type: 'permission_denied', toolUseId: 't2', toolName: 'Write', reason: 'outside' }
    ], view)
    expect(toolState(view.items[1] as ToolItem, false)).toBe('denied')
  })

  it('creates a tool card for an approval that arrives before the call', () => {
    const view = play([
      { type: 'approval_request', requestId: 'r1', toolUseId: 't9', toolName: 'Edit', input: { file_path: 'a' }, reason: 'why' }
    ])
    expect(view.items[0]).toMatchObject({ kind: 'tool', name: 'Edit', approval: { requestId: 'r1', state: 'pending' } })
  })

  it('adds turn summaries to the totals and tracks status and rate limits', () => {
    const turn: AgentEvent = {
      type: 'turn_end',
      isError: false,
      subtype: 'success',
      errors: [],
      costUsd: 0.5,
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 1
    }
    const view = play([
      { type: 'status', status: 'running' },
      turn,
      turn,
      { type: 'rate_limit', status: 'allowed_warning', resetsAt: 123, utilization: 0.8, limitType: 'five_hour' },
      { type: 'init', model: 'claude-opus-5', cliVersion: '2.1.312', cwd: '/', tools: [] }
    ])
    expect(view.totals).toEqual({ costUsd: 1, inputTokens: 20, outputTokens: 10 })
    expect(view.rateLimit).toMatchObject({ status: 'allowed_warning', utilization: 0.8 })
    expect(view.info).toMatchObject({ status: 'running', model: 'claude-opus-5' })
    expect(view.cliVersion).toBe('2.1.312')
  })

  it('ignores events it already applied', () => {
    const once = play([{ type: 'user', id: 'u1', text: 'hi' }])
    expect(applyEvent(once, { sessionId: 'as-1', seq: 1, event: { type: 'user', id: 'u1', text: 'hi' } })).toBe(once)
  })
})

describe('describeTool', () => {
  it('summarizes common tools relative to the working directory', () => {
    expect(describeTool('Bash', { command: 'npm test' }, 'C:\\repo')).toBe('npm test')
    expect(describeTool('Edit', { file_path: 'C:\\repo\\src\\a.ts' }, 'C:\\repo')).toBe('src/a.ts')
    expect(describeTool('Grep', { pattern: 'TODO', path: '/repo/src' }, '/repo')).toBe('TODO in src')
    expect(describeTool('mcp__x__y', { query: 'q' }, '/repo')).toBe('q')
  })
})
