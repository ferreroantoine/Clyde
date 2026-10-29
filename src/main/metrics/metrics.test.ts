import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, AgentSessionInfo } from '@shared/agent'
import type { Profile } from '@shared/profiles'
import { migrate } from '../services/db/database'
import { localDay } from '@shared/metrics'
import { MetricsService } from './metrics'

const profile = (id: string, kind: Profile['kind'], name: string) => ({ id, kind, name, color: '#6366f1' }) as Profile

function setup() {
  const db = new Database(':memory:')
  migrate(db)
  let now = new Date(2026, 9, 28, 10, 0).getTime()
  const active: AgentSessionInfo[] = []
  const profiles = [profile('p-claude', 'claude-code', 'Claude perso'), profile('p-api', 'anthropic', 'API'), profile('p-oai', 'openai', 'OpenAI'), profile('p-local', 'ollama', 'Local')]
  const metrics = new MetricsService(db, { profiles: () => profiles, activeSessions: () => active, now: () => now })
  const session = (id: string, profileId: string, kind: Profile['kind'], model: string): AgentSessionInfo => ({
    id,
    profileId,
    kind,
    model,
    permissionLevel: 'validate-all',
    cwd: '/repo',
    mcpTools: [],
    agentId: null,
    taskId: null,
    status: 'idle',
    createdAt: now
  })
  let seq = 0
  const emit = (sessionId: string, event: AgentEvent) => metrics.onEvent({ sessionId, seq: ++seq, event })
  const turn = (costUsd: number | null, inputTokens: number, outputTokens: number): AgentEvent => ({
    type: 'turn_end',
    isError: false,
    subtype: 'success',
    errors: [],
    costUsd,
    inputTokens,
    outputTokens,
    durationMs: 1000
  })
  return { db, metrics, active, session, emit, turn, advance: (ms: number) => (now += ms) }
}

describe('MetricsService', () => {
  it('records sessions, reported and estimated costs, and the transcript', () => {
    const h = setup()
    const cc = h.session('as-1', 'p-claude', 'claude-code', 'claude-sonnet-5')
    h.metrics.onSession(cc)
    h.active.push(cc)
    h.emit('as-1', { type: 'user', id: 'u', text: 'Fix the login bug' })
    h.emit('as-1', { type: 'text_delta', key: 'k', text: 'Look' })
    h.emit('as-1', { type: 'text', key: 'k', text: 'Looking.' })
    h.emit('as-1', h.turn(0.04, 10_000, 500))
    h.emit('as-1', { type: 'rate_limit', status: 'allowed_warning', resetsAt: 1_800_000_000, utilization: 0.82, limitType: 'five_hour' })

    const api = h.session('as-2', 'p-api', 'anthropic', 'claude-opus-5-5-20261001')
    h.metrics.onSession(api)
    h.emit('as-2', h.turn(null, 1_000_000, 100_000))
    const oai = h.session('as-3', 'p-oai', 'openai', 'gpt-unknown')
    h.metrics.onSession(oai)
    h.emit('as-3', h.turn(null, 1000, 100))
    const local = h.session('as-4', 'p-local', 'ollama', 'qwen3-coder:30b')
    h.metrics.onSession(local)
    h.emit('as-4', h.turn(null, 2000, 200))

    const d = h.metrics.dashboard('7d')
    const by = Object.fromEntries(d.profiles.map((p) => [p.profileId, p]))
    expect(by['p-claude']).toMatchObject({ activeSessions: 1, sessions: 1, inputTokens: 10_000, costUsd: 0.04, costEstimated: false })
    expect(by['p-claude']?.rateLimit).toMatchObject({ status: 'allowed_warning', utilization: 0.82 })
    expect(by['p-api']?.costUsd).toBeCloseTo(6) // 1M in at $4 + 100k out at $20
    expect(by['p-api']?.costEstimated).toBe(true)
    expect(by['p-oai']).toMatchObject({ costUsd: 0, unpricedTurns: 1, costEstimated: true })
    expect(by['p-local']).toMatchObject({ inputTokens: 2000, costUsd: 0, unpricedTurns: 0, costEstimated: false })
    expect(d.sessions.map((s) => s.id).sort()).toEqual(['as-1', 'as-2', 'as-3', 'as-4'])
    expect(d.sessions.find((s) => s.id === 'as-1')).toMatchObject({ title: 'Fix the login bug', turns: 1, costUsd: 0.04 })
    expect(d.daily).toContainEqual({ day: localDay(new Date(2026, 9, 28).getTime()), profileId: 'p-claude', inputTokens: 10_000, outputTokens: 500, costUsd: 0.04 })

    const t = h.metrics.transcript('as-1')
    expect(t.events.map((e) => e.event.type)).toEqual(['user', 'text', 'turn_end', 'rate_limit'])
  })

  it('limits the dashboard to the range and closes sessions left open by a crash', () => {
    const h = setup()
    h.metrics.onSession(h.session('as-old', 'p-claude', 'claude-code', 'm'))
    h.emit('as-old', h.turn(1, 1, 1))
    h.advance(3 * 24 * 60 * 60 * 1000)
    h.metrics.onSession(h.session('as-new', 'p-claude', 'claude-code', 'm'))
    h.emit('as-new', h.turn(2, 1, 1))
    expect(h.metrics.dashboard('24h').profiles.find((p) => p.profileId === 'p-claude')?.costUsd).toBe(2)
    expect(h.metrics.dashboard('7d').profiles.find((p) => p.profileId === 'p-claude')?.costUsd).toBe(3)
    h.metrics.recover()
    expect(h.metrics.dashboard('7d').sessions.every((s) => s.status === 'stopped' && s.endedAt !== null)).toBe(true)
  })

  it('ships seeded prices that users can edit or replace', () => {
    const h = setup()
    const seeded = h.metrics.prices()
    expect(seeded.find((p) => p.modelPrefix === 'claude-sonnet-5-5')).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10, source: 'seed' })
    const withGpt = h.metrics.savePrice({ kind: 'openai', modelPrefix: 'gpt-5', inputPerMTok: 1.25, outputPerMTok: 10 })
    const gpt = withGpt.find((p) => p.modelPrefix === 'gpt-5')
    expect(gpt?.source).toBe('user')
    expect(() => h.metrics.savePrice({ kind: 'openai', modelPrefix: 'gpt-5', inputPerMTok: 1, outputPerMTok: 1 })).toThrow(/already/)
    expect(h.metrics.deletePrice(gpt?.id ?? '').some((p) => p.modelPrefix === 'gpt-5')).toBe(false)
  })
})
