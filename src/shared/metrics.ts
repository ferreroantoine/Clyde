import type { AgentEventEnvelope, AgentStatus } from './agent'
import type { ProfileKind } from './profiles'

export type MetricsRange = '24h' | '7d' | '30d'
export const RANGE_DAYS: Record<MetricsRange, number> = { '24h': 1, '7d': 7, '30d': 30 }

/** Local calendar day of a timestamp, YYYY-MM-DD, as the dashboard groups by. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Every local day a range touches, oldest first, so charts show empty days too. */
export function daysIn(range: MetricsRange, now: number): string[] {
  const out: string[] = []
  for (let i = RANGE_DAYS[range]; i >= 0; i--) {
    const day = localDay(now - i * 86_400_000)
    if (!out.includes(day)) out.push(day)
  }
  return range === '24h' ? out.slice(-2) : out.slice(1)
}

export interface ProfileUsage {
  profileId: string
  name: string
  color: string
  kind: ProfileKind
  activeSessions: number
  sessions: number
  inputTokens: number
  outputTokens: number
  /** Reported (Claude Code) plus estimated (API) cost. */
  costUsd: number
  /** True when part of the cost is an estimate, or some turns had no known price. */
  costEstimated: boolean
  unpricedTurns: number
  rateLimit: {
    status: 'allowed' | 'allowed_warning' | 'rejected'
    utilization: number | null
    resetsAt: number | null
    limitType: string | null
    at: number
  } | null
}

export interface DailyUsage {
  /** Local day, YYYY-MM-DD. */
  day: string
  profileId: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface SessionRecord {
  id: string
  profileId: string
  profileName: string
  kind: ProfileKind
  model: string
  agentId: string | null
  taskId: string | null
  title: string | null
  cwd: string
  status: AgentStatus
  startedAt: number
  endedAt: number | null
  turns: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  costEstimated: boolean
}

export interface Dashboard {
  range: MetricsRange
  /** When main computed it; charts lay out days from here. */
  generatedAt: number
  profiles: ProfileUsage[]
  daily: DailyUsage[]
  sessions: SessionRecord[]
}

export interface SessionTranscript {
  session: SessionRecord
  events: AgentEventEnvelope[]
}
