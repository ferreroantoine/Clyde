import { randomUUID } from 'node:crypto'
import type { AgentEventEnvelope, AgentSessionInfo, AgentStatus } from '@shared/agent'
import { AppError } from '@shared/errors'
import type { Dashboard, DailyUsage, MetricsRange, ProfileUsage, SessionRecord, SessionTranscript } from '@shared/metrics'
import { localDay, RANGE_DAYS } from '@shared/metrics'
import { estimateCost, priceInputSchema, type PriceInput, type PriceRow, type PricedKind } from '@shared/pricing'
import type { Profile, ProfileKind } from '@shared/profiles'
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
}

const toRecord = (r: SessionRow): SessionRecord => ({
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
  costUsd: r.cost_usd,
  costEstimated: r.cost_estimated === 1
})

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
        throw new AppError('invalid_request', `There is already a price for ${data.modelPrefix}`)
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
        `INSERT INTO sessions (id, profile_id, profile_name, kind, model, agent_id, task_id, cwd, status, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET model = excluded.model, status = excluded.status,
           ended_at = COALESCE(sessions.ended_at, excluded.ended_at)`
      )
      .run(
        info.id,
        info.profileId,
        profile?.name ?? 'Deleted account',
        info.kind,
        info.model,
        info.agentId,
        info.taskId,
        info.cwd,
        info.status,
        info.createdAt,
        ended
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
            `INSERT INTO usage_events (session_id, profile_id, model, at, input_tokens, output_tokens, cost_usd, estimated)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(sessionId, session.profile_id, session.model, at, event.inputTokens, event.outputTokens, cost, estimated ? 1 : 0)
        this.db
          .prepare(
            `UPDATE sessions SET turns = turns + 1, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
               cost_usd = cost_usd + ?, cost_estimated = MAX(cost_estimated, ?) WHERE id = ?`
          )
          .run(event.inputTokens, event.outputTokens, cost ?? 0, estimated ? 1 : 0, sessionId)
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
        `SELECT profile_id, COUNT(DISTINCT session_id) AS sessions, SUM(input_tokens) AS input, SUM(output_tokens) AS output,
                SUM(COALESCE(cost_usd, 0)) AS cost, MAX(estimated) AS estimated, SUM(cost_usd IS NULL) AS unpriced
         FROM usage_events WHERE at >= ? GROUP BY profile_id`
      )
      .all(since) as Array<{ profile_id: string; sessions: number; input: number; output: number; cost: number; estimated: number; unpriced: number }>
    const byProfile = new Map(usage.map((u) => [u.profile_id, u]))
    const active = this.deps.activeSessions().filter((s) => !ENDED.includes(s.status))

    const latestLimit = this.db.prepare(
      'SELECT status, utilization, resets_at, limit_type, at FROM rate_limit_events WHERE profile_id = ? ORDER BY at DESC, id DESC LIMIT 1'
    )
    const profiles: ProfileUsage[] = this.deps.profiles().map((p) => {
      const u = byProfile.get(p.id)
      // Local models cost nothing: their cost is exact and never "unpriced".
      const local = p.kind === 'ollama'
      const unpriced = local ? 0 : (u?.unpriced ?? 0)
      const limit = latestLimit.get(p.id) as
        | { status: string; utilization: number | null; resets_at: number | null; limit_type: string | null; at: number }
        | undefined
      return {
        profileId: p.id,
        name: p.name,
        color: p.color,
        kind: p.kind,
        activeSessions: active.filter((s) => s.profileId === p.id).length,
        sessions: u?.sessions ?? 0,
        inputTokens: u?.input ?? 0,
        outputTokens: u?.output ?? 0,
        costUsd: u?.cost ?? 0,
        costEstimated: !local && ((u?.estimated ?? 0) === 1 || unpriced > 0),
        unpricedTurns: unpriced,
        rateLimit: limit
          ? {
              status: limit.status as 'allowed' | 'allowed_warning' | 'rejected',
              utilization: limit.utilization,
              resetsAt: limit.resets_at,
              limitType: limit.limit_type,
              at: limit.at
            }
          : null
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
    ).map(toRecord)
    return { range, generatedAt: this.now(), profiles, daily: [...daily.values()], sessions }
  }

  transcript(sessionId: string): SessionTranscript {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined
    if (!row) throw new AppError('not_found', 'This session is not in the history')
    const events = (
      this.db.prepare('SELECT seq, event FROM session_events WHERE session_id = ? ORDER BY seq').all(sessionId) as Array<{
        seq: number
        event: string
      }>
    ).map((e) => ({ sessionId, seq: e.seq, event: JSON.parse(e.event) }))
    return { session: toRecord(row), events }
  }
}
