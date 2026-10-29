import { randomUUID } from 'node:crypto'
import type { AgentEvent, ApprovalDecision } from '@shared/agent'
import { AppError } from '@shared/errors'

export type ApprovalOutcome = { behavior: 'allow' } | { behavior: 'deny'; message: string }

export interface ApprovalQuestion {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  reason: string
}

interface Pending {
  sessionId: string
  rule: string
  resolve: (outcome: ApprovalOutcome) => void
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor', 'run_command'])

/**
 * What "allow for this session" covers: the exact command for shell tools, the whole tool otherwise.
 * Allowing one command never allows the next, different one.
 */
export function sessionRuleFor(toolName: string, input: Record<string, unknown>): string {
  if (SHELL_TOOLS.has(toolName)) return `${toolName}:${typeof input['command'] === 'string' ? input['command'] : ''}`
  return toolName
}

/** Holds tool calls that wait for the user, and the session-scoped allow rules their answers create. */
export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>()
  private readonly rules = new Map<string, Set<string>>()

  constructor(private readonly emit: (sessionId: string, event: AgentEvent) => void) {}

  ask(sessionId: string, question: ApprovalQuestion, signal?: AbortSignal): Promise<ApprovalOutcome> {
    const rule = sessionRuleFor(question.toolName, question.input)
    if (this.rules.get(sessionId)?.has(rule)) return Promise.resolve({ behavior: 'allow' })

    const requestId = randomUUID()
    return new Promise<ApprovalOutcome>((resolve) => {
      this.pending.set(requestId, { sessionId, rule, resolve })
      signal?.addEventListener('abort', () => this.cancel(requestId, 'The request was cancelled'), { once: true })
      this.emit(sessionId, { type: 'approval_request', requestId, ...question })
    })
  }

  answer(sessionId: string, requestId: string, decision: ApprovalDecision, message?: string): void {
    const entry = this.pending.get(requestId)
    if (!entry || entry.sessionId !== sessionId) throw new AppError('not_found', 'This request was already answered')
    this.pending.delete(requestId)
    if (decision === 'allow-session') {
      let set = this.rules.get(sessionId)
      if (!set) this.rules.set(sessionId, (set = new Set()))
      set.add(entry.rule)
    }
    this.emit(sessionId, { type: 'approval_resolved', requestId, decision })
    entry.resolve(
      decision === 'deny'
        ? { behavior: 'deny', message: message?.trim() || 'The user denied this tool call.' }
        : { behavior: 'allow' }
    )
  }

  hasPending(sessionId: string): boolean {
    for (const p of this.pending.values()) if (p.sessionId === sessionId) return true
    return false
  }

  /** Denies everything still waiting for a session, e.g. when it is interrupted or stopped. */
  cancelSession(sessionId: string, message = 'The session was stopped'): void {
    for (const [id, p] of this.pending) if (p.sessionId === sessionId) this.cancel(id, message)
  }

  forgetSession(sessionId: string): void {
    this.cancelSession(sessionId)
    this.rules.delete(sessionId)
  }

  private cancel(requestId: string, message: string): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    this.pending.delete(requestId)
    this.emit(entry.sessionId, { type: 'approval_resolved', requestId, decision: 'cancelled' })
    entry.resolve({ behavior: 'deny', message })
  }
}
