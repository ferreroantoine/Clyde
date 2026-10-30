import { t } from '@shared/i18n'
import type { AgentEvent } from '@shared/agent'
import type { FileUpdateChange, Notifications, ThreadItem, TokenUsageBreakdown, Turn, TurnError } from './protocol'

const MAX_RESULT_CHARS = 20_000
const MAX_DIFF_CHARS = 4_000

const clip = (text: string, max = MAX_RESULT_CHARS) => (text.length > max ? `${text.slice(0, max)}\n… [truncated]` : text)

/** The shell tool name the panel and the permission engine know, per platform. */
export function shellToolName(platform: NodeJS.Platform): 'PowerShell' | 'Bash' {
  return platform === 'win32' ? 'PowerShell' : 'Bash'
}

/** `atelier/0.165.0 (…)`: Codex puts its own version after the client name. */
export function versionFromUserAgent(userAgent: string): string {
  return /\/(\d+\.\d+\.\d+[\w.-]*)/.exec(userAgent)?.[1] ?? ''
}

function statusOf(error: TurnError): number | null {
  const info = error.codexErrorInfo
  if (info && typeof info === 'object') {
    for (const value of Object.values(info as Record<string, unknown>)) {
      const status = (value as { httpStatusCode?: unknown } | null)?.httpStatusCode
      if (typeof status === 'number') return status
    }
  }
  return null
}

/** A sentence for the panel from a Codex error, with the usual causes spelled out. */
export function describeCodexError(error: TurnError): string {
  const info = error.codexErrorInfo
  if (info === 'unauthorized' || statusOf(error) === 401) {
    return t('Codex is not signed in for this account, or its sign-in expired. Open Accounts to sign in again.')
  }
  if (info === 'usageLimitExceeded') return t('The ChatGPT plan hit a usage limit. Wait for the reset or switch to another account.')
  if (info === 'rateLimitExceeded' || statusOf(error) === 429) return t('Codex is rate limited. Try again in a moment.')
  if (info === 'contextWindowExceeded') return t('The conversation no longer fits the model’s context window. Start a new session.')
  if (info === 'modelNotFound') return t('This model is not available for the account. Pick another model.')
  if (info === 'serverOverloaded') return t('The model is overloaded. Try again in a moment.')
  return error.message
}

function mcpResultText(result: { content: unknown[] } | null): string {
  if (!result) return ''
  return result.content
    .map((part) => {
      const p = part as { type?: string; text?: string }
      return p?.type === 'text' ? (p.text ?? '') : p?.type === 'image' ? '[image]' : ''
    })
    .filter(Boolean)
    .join('\n')
}

const changeKind = (c: FileUpdateChange) => (c.kind.type === 'update' && c.kind.move_path ? 'move' : c.kind.type)

/**
 * Turns app-server notifications into panel events. Stateful: it remembers file changes
 * (approval requests only carry the item id) and the thread's token totals, so each turn
 * reports its own usage.
 */
export class CodexTranslator {
  private readonly fileChanges = new Map<string, FileUpdateChange[]>()
  private total: TokenUsageBreakdown | null = null
  private totalAtTurnStart: TokenUsageBreakdown | null = null
  /** The final error already shown for this turn, so turn_end does not repeat it. */
  private shownError: string | null = null
  /** Tokens of the latest request, i.e. how full the context window is. */
  contextTokens: number | null = null
  contextWindow: number | null = null

  constructor(private readonly platform: NodeJS.Platform) {}

  /** Paths a pending file change touches, for its approval. */
  changesOf(itemId: string): FileUpdateChange[] {
    return this.fileChanges.get(itemId) ?? []
  }

  translate<M extends keyof Notifications>(method: M, params: Notifications[M]): AgentEvent[]
  translate(method: string, params: unknown): AgentEvent[]
  translate(method: string, params: unknown): AgentEvent[] {
    switch (method) {
      case 'item/agentMessage/delta': {
        const p = params as Notifications['item/agentMessage/delta']
        return p.delta ? [{ type: 'text_delta', key: p.itemId, text: p.delta }] : []
      }
      case 'item/commandExecution/outputDelta': {
        const p = params as Notifications['item/commandExecution/outputDelta']
        return p.delta ? [{ type: 'tool_output', toolUseId: p.itemId, chunk: p.delta }] : []
      }
      case 'item/started':
        return this.itemStarted((params as Notifications['item/started']).item)
      case 'item/completed':
        return this.itemCompleted((params as Notifications['item/completed']).item)
      case 'turn/started':
        this.totalAtTurnStart = this.total
        return []
      case 'turn/completed':
        return [this.turnEnd((params as Notifications['turn/completed']).turn)]
      case 'thread/compacted':
        return [{ type: 'context_compacted' }]
      case 'thread/tokenUsage/updated': {
        const usage = (params as Notifications['thread/tokenUsage/updated']).tokenUsage
        this.total = usage.total
        this.contextTokens = usage.last.inputTokens + usage.last.outputTokens
        this.contextWindow = usage.modelContextWindow
        return []
      }
      case 'error': {
        const p = params as Notifications['error']
        // Retries are reported as errors too ("Reconnecting... 2/5"); only the final one counts.
        if (p.willRetry) return []
        this.shownError = describeCodexError(p.error)
        return [{ type: 'error', message: this.shownError }]
      }
      default:
        return []
    }
  }

  private itemStarted(item: ThreadItem): AgentEvent[] {
    const call = (name: string, input: Record<string, unknown>): AgentEvent[] => [
      { type: 'tool_call', toolUseId: item.id, name, input, parentToolUseId: null }
    ]
    switch (item.type) {
      case 'commandExecution': {
        const it = item as Extract<ThreadItem, { type: 'commandExecution' }>
        return call(shellToolName(this.platform), { command: it.command, cwd: it.cwd })
      }
      case 'fileChange': {
        const it = item as Extract<ThreadItem, { type: 'fileChange' }>
        this.fileChanges.set(it.id, it.changes)
        return call('Edit', {
          file_path: it.changes[0]?.path ?? '',
          changes: it.changes.map((c) => ({ path: c.path, kind: changeKind(c), diff: clip(c.diff, MAX_DIFF_CHARS) }))
        })
      }
      case 'mcpToolCall': {
        const it = item as Extract<ThreadItem, { type: 'mcpToolCall' }>
        const args = it.arguments && typeof it.arguments === 'object' ? (it.arguments as Record<string, unknown>) : {}
        return call(`mcp__${it.server}__${it.tool}`, args)
      }
      case 'webSearch':
        return call('WebSearch', { query: (item as Extract<ThreadItem, { type: 'webSearch' }>).query })
      default:
        return []
    }
  }

  private itemCompleted(item: ThreadItem): AgentEvent[] {
    const result = (content: string, isError: boolean): AgentEvent[] => [{ type: 'tool_result', toolUseId: item.id, content, isError }]
    switch (item.type) {
      case 'agentMessage': {
        const text = (item as Extract<ThreadItem, { type: 'agentMessage' }>).text
        return text ? [{ type: 'text', key: item.id, text }] : []
      }
      case 'commandExecution': {
        const it = item as Extract<ThreadItem, { type: 'commandExecution' }>
        if (it.status === 'declined') return result('The command was declined.', true)
        const output = clip(it.aggregatedOutput ?? '')
        const code = it.exitCode
        const tail = code !== null && code !== 0 ? `${output ? '\n' : ''}[exit code ${code}]` : ''
        return result(output + tail, it.status === 'failed' || (code !== null && code !== 0))
      }
      case 'fileChange': {
        const it = item as Extract<ThreadItem, { type: 'fileChange' }>
        this.fileChanges.delete(it.id)
        if (it.status === 'declined') return result('The change was declined.', true)
        const files = it.changes.map((c) => `${changeKind(c)} ${c.path}`).join('\n')
        return result(it.status === 'failed' ? t('The change failed.\n{files}', { files }) : files, it.status === 'failed')
      }
      case 'mcpToolCall': {
        const it = item as Extract<ThreadItem, { type: 'mcpToolCall' }>
        if (it.error) return result(it.error.message, true)
        return result(clip(mcpResultText(it.result)), it.status === 'failed')
      }
      case 'webSearch':
        return result(t('Searched: {query}', { query: (item as Extract<ThreadItem, { type: 'webSearch' }>).query }), false)
      default:
        return []
    }
  }

  private turnEnd(turn: Turn): AgentEvent {
    const now = this.total
    const before = this.totalAtTurnStart
    const delta = (key: keyof TokenUsageBreakdown) => Math.max(0, (now?.[key] ?? 0) - (before?.[key] ?? 0))
    this.totalAtTurnStart = now
    const failed = turn.status === 'failed'
    const message = failed && turn.error ? describeCodexError(turn.error) : null
    const shown = this.shownError
    this.shownError = null
    return {
      type: 'turn_end',
      isError: failed,
      subtype: turn.status === 'completed' ? 'success' : turn.status,
      errors: message && message !== shown ? [message] : [],
      // A ChatGPT plan has no per-turn price; plan usage arrives as rate limits.
      costUsd: null,
      inputTokens: delta('inputTokens'),
      outputTokens: delta('outputTokens'),
      durationMs: turn.durationMs ?? 0,
      cacheReadTokens: delta('cachedInputTokens'),
      cacheWriteTokens: delta('cacheWriteInputTokens'),
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow
    }
  }
}
