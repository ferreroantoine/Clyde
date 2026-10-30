import { t } from '@shared/i18n'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentEventEnvelope, AgentSessionInfo, AgentStatus, ContextBreakdown } from '@shared/agent'
import { AppError } from '@shared/errors'
import type { Dashboard, DailyUsage, MetricsRange, ProfileUsage, SessionRecord, SessionTranscript } from '@shared/metrics'
import { localDay, RANGE_DAYS } from '@shared/metrics'
import { estimateCost, priceInputSchema, type PriceInput, type PriceRow, type PricedKind } from '@shared/pricing'
import type { Profile, ProfileKind } from '@shared/profiles'
import type { Billing, SessionLimitUsage } from '@shared/limits'
import type { Db } from '../services/db/database'

const DAY = 24 * 60 * 60 * 1000
/** Streaming fragments are rebuilt from the final text, so the history skips them. */
const NOT_STORED = new Set(['text_delta', 'tool_output'])
const ENDED: AgentStatus[] = ['stopped', 'error']

interface SessionRow {
  id: string
  profile_id: string
  profile_name: string
  kind: string
  model: string
  agent_id: string | null
  task_id: string | null
  title: string | null
  cwd: string
  status: string
  started_at: number
  ended_at: number | null
  turns: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  cost_estimated: number
  billing: string
  cache_read_tokens: number
  context_tokens: number | null
  context_window: number | null
}

const toRecord = (r: SessionRow, limits: SessionLimitUsage[] = [], breakdown: ContextBreakdown | null = null): SessionRecord => ({
  id: r.id,
  profileId: r.profile_id,
  profileName: r.profile_name,
  kind: r.kind as ProfileKind,
  model: r.model,
  agentId: r.agent_id,
  taskId: r.task_id,
  title: r.title,
  cwd: r.cwd,
  status: r.status as AgentStatus,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  turns: r.turns,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  cacheReadTokens: r.cache_read_tokens ?? 0,
  contextTokens: r.context_tokens ?? null,
  contextWindow: r.context_window ?? null,
  breakdown,
  costUsd: r.cost_usd,
  costEstimated: r.cost_estimated === 1,
  billing: r.billing as Billing,
  limits
})

/** How a profile's sessions are paid. */
export function billingOf(profile: Pick<Profile, 'auth' | 'kind'>): Billing {
  if (profile.auth === 'subscription') return 'subscription'
  return profile.kind === 'ollama' ? 'local' : 'api'
}

/**
 * Records sessions, their transcripts, token usage, costs and rate limits, and answers the
 * supervision dashboard. Fed by the AgentManager's session and event callbacks.
 */
export class MetricsService {
  constructor(
    private readonly db: Db,
    private readonly deps: {
      profiles: () => Profile[]
      activeSessions: () => AgentSessionInfo[]
      /** Plan points each session used, from the limits service. */
      sessionLimits?: (sessionId: string) => SessionLimitUsage[]
      now?: () => number
    }
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  // Prices

  prices(): PriceRow[] {
    const rows = this.db.prepare('SELECT * FROM pricing ORDER BY kind, model_prefix').all() as Array<{
      id: string
      kind: string
      model_prefix: string
      input_per_mtok: number
      output_per_mtok: number
      source: string
      updated_at: number
    }>
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as PricedKind,
      modelPrefix: r.model_prefix,
      inputPerMTok: r.input_per_mtok,
      outputPerMTok: r.output_per_mtok,
      source: r.source as 'seed' | 'user',
      updatedAt: r.updated_at
    }))
  }

  savePrice(input: PriceInput & { id?: string }): PriceRow[] {
    const data = priceInputSchema.parse(input)
    const id = input.id ?? randomUUID()
    try {
      this.db
        .prepare(
          `INSERT INTO pricing (id, kind, model_prefix, input_per_mtok, output_per_mtok, source, updated_at)
           VALUES (?, ?, ?, ?, ?, 'user', ?)
           ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, model_prefix = excluded.model_prefix,
             input_per_mtok = excluded.input_per_mtok, output_per_mtok = excluded.output_per_mtok,
             source = 'user', updated_at = excluded.updated_at`
        )
        .run(id, data.kind, data.modelPrefix, data.inputPerMTok, data.outputPerMTok, this.now())
    } catch (err) {
      if (/UNIQUE/.test((err as Error).message)) {
        throw new AppError('invalid_request', t('There is already a price for {modelPrefix}', { modelPrefix: data.modelPrefix }))
      }
      throw err
    }
    return this.prices()
  }

  deletePrice(id: string): PriceRow[] {
    this.db.prepare('DELETE FROM pricing WHERE id = ?').run(id)
    return this.prices()
  }

  // Recording

  onSession(info: AgentSessionInfo): void {
    const profile = this.deps.profiles().find((p) => p.id === info.profileId)
    const ended = ENDED.includes(info.status) ? this.now() : null
    this.db
      .prepare(
        `INSERT INTO sessions (id, profile_id, profile_name, kind, model, agent_id, task_id, cwd, status, started_at, ended_at, billing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET model = excluded.model, status = excluded.status,
           ended_at = COALESCE(sessions.ended_at, excluded.ended_at)`
      )
      .run(
        info.id,
        info.profileId,
        profile?.name ?? t('Deleted account'),
        info.kind,
        info.model,
        info.agentId,
        info.taskId,
        info.cwd,
        info.status,
        info.createdAt,
        ended,
        profile ? billingOf(profile) : info.kind === 'ollama' ? 'local' : info.kind === 'codex' || info.kind === 'antigravity' ? 'subscription' : 'api'
      )
  }

  onEvent(envelope: AgentEventEnvelope): void {
    const { sessionId, seq, event } = envelope
    const at = this.now()
    if (!NOT_STORED.has(event.type)) {
      this.db
        .prepare('INSERT OR IGNORE INTO session_events (session_id, seq, at, event) VALUES (?, ?, ?, ?)')
        .run(sessionId, seq, at, JSON.stringify(event))
    }
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined
    if (!session) return
    if (event.type === 'user' && !session.title) {
      this.db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(event.text.trim().slice(0, 120), sessionId)
    } else if (event.type === 'turn_end') {
      const reported = event.costUsd
      const cost = reported ?? estimateCost(this.prices(), session.kind as ProfileKind, session.model, event.inputTokens, event.outputTokens)
      const estimated = reported === null
      this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO usage_events (session_id, profile_id, model, at, input_tokens, output_tokens, cost_usd, estimated, cache_read_tokens, cache_write_tokens)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(sessionId, session.profile_id, session.model, at, event.inputTokens, event.outputTokens, cost, estimated ? 1 : 0, event.cacheReadTokens ?? 0, event.cacheWriteTokens ?? 0)
        this.db
          .prepare(
            `UPDATE sessions SET turns = turns + 1, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
               cost_usd = cost_usd + ?, cost_estimated = MAX(cost_estimated, ?), cache_read_tokens = cache_read_tokens + ?,
               context_tokens = COALESCE(?, context_tokens), context_window = COALESCE(?, context_window) WHERE id = ?`
          )
          .run(event.inputTokens, event.outputTokens, cost ?? 0, estimated ? 1 : 0, event.cacheReadTokens ?? 0, event.contextTokens ?? null, event.contextWindow ?? null, sessionId)
        if (event.breakdown) {
          const b = event.breakdown
          this.db
            .prepare('INSERT INTO turn_context (session_id, at, system, memory, tools, history, tool_results, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(sessionId, at, b.system, b.memory, b.tools, b.history, b.toolResults, b.output)
        }
      })()
    } else if (event.type === 'rate_limit') {
      this.db
        .prepare(
          `INSERT INTO rate_limit_events (profile_id, session_id, at, status, utilization, resets_at, limit_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(session.profile_id, sessionId, at, event.status, event.utilization, event.resetsAt, event.limitType)
    }
  }

  /** Sessions still marked running belong to a previous run of the app. */
  recover(): void {
    this.db
      .prepare(`UPDATE sessions SET status = 'stopped', ended_at = COALESCE(ended_at, ?) WHERE status NOT IN ('stopped', 'error')`)
      .run(this.now())
  }

  // Queries

  dashboard(range: MetricsRange): Dashboard {
    const since = this.now() - RANGE_DAYS[range] * DAY
    const usage = this.db
      .prepare(
        `SELECT u.profile_id, COUNT(DISTINCT u.session_id) AS sessions, SUM(u.input_tokens) AS input, SUM(u.output_tokens) AS output,
                SUM(CASE WHEN s.billing = 'api' THEN COALESCE(u.cost_usd, 0) ELSE 0 END) AS cost,
                MAX(CASE WHEN s.billing = 'api' THEN u.estimated ELSE 0 END) AS estimated,
                SUM(CASE WHEN s.billing = 'api' AND u.cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced,
                SUM(u.cache_read_tokens) AS cache_read
         FROM usage_events u LEFT JOIN sessions s ON s.id = u.session_id WHERE u.at >= ? GROUP BY u.profile_id`
      )
      .all(since) as Array<{ profile_id: string; sessions: number; input: number; output: number; cost: number; estimated: number; unpriced: number; cache_read: number }>
    const byProfile = new Map(usage.map((u) => [u.profile_id, u]))
    const active = this.deps.activeSessions().filter((s) => !ENDED.includes(s.status))

    const profiles: ProfileUsage[] = this.deps.profiles().map((p) => {
      const u = byProfile.get(p.id)
      // Local models cost nothing: their cost is exact and never "unpriced".
      const local = p.kind === 'ollama'
      const unpriced = local ? 0 : (u?.unpriced ?? 0)
      return {
        profileId: p.id,
        name: p.name,
        color: p.color,
        kind: p.kind,
        billing: billingOf(p),
        activeSessions: active.filter((s) => s.profileId === p.id).length,
        sessions: u?.sessions ?? 0,
        inputTokens: u?.input ?? 0,
        outputTokens: u?.output ?? 0,
        costUsd: u?.cost ?? 0,
        costEstimated: !local && ((u?.estimated ?? 0) === 1 || unpriced > 0),
        cacheReadTokens: u?.cache_read ?? 0,
        unpricedTurns: unpriced
      }
    })

    const events = this.db
      .prepare('SELECT profile_id, at, input_tokens, output_tokens, cost_usd FROM usage_events WHERE at >= ? ORDER BY at')
      .all(since) as Array<{ profile_id: string; at: number; input_tokens: number; output_tokens: number; cost_usd: number | null }>
    const daily = new Map<string, DailyUsage>()
    for (const e of events) {
      const day = localDay(e.at)
      const key = `${day}|${e.profile_id}`
      const d = daily.get(key) ?? { day, profileId: e.profile_id, inputTokens: 0, outputTokens: 0, costUsd: 0 }
      d.inputTokens += e.input_tokens
      d.outputTokens += e.output_tokens
      d.costUsd += e.cost_usd ?? 0
      daily.set(key, d)
    }

    const sessions = (
      this.db.prepare('SELECT * FROM sessions WHERE started_at >= ? ORDER BY started_at DESC LIMIT 100').all(since) as SessionRow[]
    ).map((r) => toRecord(r, this.deps.sessionLimits?.(r.id) ?? [], this.breakdownOf(r.id)))
    return { range, generatedAt: this.now(), profiles, daily: [...daily.values()], sessions }
  }

  /** A session's tokens by part, summed over its turns (Clyde's own loop only). */
  private breakdownOf(sessionId: string): ContextBreakdown | null {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n, SUM(system) AS system, SUM(memory) AS memory, SUM(tools) AS tools, SUM(history) AS history,
                SUM(tool_results) AS tool_results, SUM(output) AS output FROM turn_context WHERE session_id = ?`
      )
      .get(sessionId) as { n: number; system: number; memory: number; tools: number; history: number; tool_results: number; output: number }
    if (!row.n) return null
    return { system: row.system, memory: row.memory, tools: row.tools, history: row.history, toolResults: row.tool_results, output: row.output }
  }

  /** A session as plain text (what was asked, answered and which tools ran), for summaries and memory. */
  transcriptText(sessionId: string): string {
    const rows = this.db.prepare('SELECT event FROM session_events WHERE session_id = ? ORDER BY seq').all(sessionId) as Array<{ event: string }>
    const lines: string[] = []
    for (const row of rows) {
      const event = JSON.parse(row.event) as AgentEvent
      if (event.type === 'user') lines.push(`User: ${event.text}`)
      else if (event.type === 'text') lines.push(`Assistant: ${event.text}`)
      else if (event.type === 'tool_call') lines.push(`[tool ${event.name} ${JSON.stringify(event.input).slice(0, 200)}]`)
      else if (event.type === 'tool_result' && event.isError) lines.push(`[tool error: ${event.content.slice(0, 300)}]`)
    }
    return lines.join('\n')
  }

  transcript(sessionId: string): SessionTranscript {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined
    if (!row) throw new AppError('not_found', t('This session is not in the history'))
    const events = (
      this.db.prepare('SELECT seq, event FROM session_events WHERE session_id = ? ORDER BY seq').all(sessionId) as Array<{
        seq: number
        event: string
      }>
    ).map((e) => ({ sessionId, seq: e.seq, event: JSON.parse(e.event) }))
    return { session: toRecord(row, this.deps.sessionLimits?.(row.id) ?? []), events }
  }
}
