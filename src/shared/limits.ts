/**
 * Plan usage limits (5-hour and weekly windows) of subscription accounts, as each CLI reports
 * them, and how a window's growth is split between the sessions that caused it. Pure, tested.
 */

/** official: the CLI reported it. estimated: Atelier computed it. unavailable: nothing to show. */
export type LimitBadge = 'official' | 'estimated' | 'unavailable'

export type LimitSource = 'claude-usage' | 'claude-statusline' | 'codex' | 'antigravity'

export const FIVE_HOUR = 'five_hour'
export const SEVEN_DAY = 'seven_day'
export const MAIN_WINDOWS = [FIVE_HOUR, SEVEN_DAY] as const

export const WINDOW_LABELS: Record<string, string> = {
  [FIVE_HOUR]: '5-hour window',
  [SEVEN_DAY]: 'Weekly'
}

/** One window as a CLI reported it. `resetsAt` is in milliseconds. */
export interface LimitReading {
  window: string
  label: string
  usedPct: number
  resetsAt: number | null
  source: LimitSource
}

export interface WindowState {
  window: string
  label: string
  usedPct: number | null
  resetsAt: number | null
  badge: LimitBadge
  source: LimitSource | null
  /** When the value was read. */
  at: number | null
}

export type Billing = 'subscription' | 'api' | 'local'

export interface ProfileLimits {
  profileId: string
  /** 5-hour and weekly first (unavailable when unknown), then extra windows such as per-model limits. */
  windows: WindowState[]
  updatedAt: number | null
}

/** How many points of a window one session used. */
export interface SessionLimitUsage {
  window: string
  label: string
  deltaPct: number
  badge: 'official' | 'estimated'
}

export interface LimitPoint {
  at: number
  usedPct: number
}

export interface LimitHistory {
  profileId: string
  series: Array<{ window: string; label: string; points: LimitPoint[] }>
}

export interface LimitAlert {
  profileId: string
  profileName: string
  window: string
  label: string
  threshold: number
  usedPct: number
  resetsAt: number | null
}

/** What one source answered, raw, for the diagnostic in Settings. */
export interface LimitDiagnostic {
  source: string
  ok: boolean
  output: string
}

const clampPct = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10))

function isoToMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function secondsToMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 1000 : null
}

const pctOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? clampPct(value) : null)

/**
 * Claude Code's structured /usage (Agent SDK `usage_EXPERIMENTAL…()`): utilization 0-100 and
 * ISO reset times per window, per-model weekly windows, and model-scoped ones.
 */
export function parseClaudeUsage(response: unknown): LimitReading[] {
  const limits = (response as { rate_limits?: Record<string, unknown> | null } | null)?.rate_limits
  if (!limits || typeof limits !== 'object') return []
  const out: LimitReading[] = []
  const named: Array<[string, string]> = [
    [FIVE_HOUR, WINDOW_LABELS[FIVE_HOUR] as string],
    [SEVEN_DAY, WINDOW_LABELS[SEVEN_DAY] as string],
    ['seven_day_opus', 'Weekly · Opus'],
    ['seven_day_sonnet', 'Weekly · Sonnet']
  ]
  for (const [key, label] of named) {
    const w = limits[key] as { utilization?: unknown; resets_at?: unknown } | null | undefined
    const pct = pctOf(w?.utilization)
    if (w && pct !== null) out.push({ window: key, label, usedPct: pct, resetsAt: isoToMs(w.resets_at), source: 'claude-usage' })
  }
  const scoped = limits['model_scoped']
  if (Array.isArray(scoped)) {
    for (const s of scoped as Array<{ display_name?: unknown; utilization?: unknown; resets_at?: unknown }>) {
      const pct = pctOf(s.utilization)
      if (typeof s.display_name !== 'string' || pct === null) continue
      out.push({
        window: `model:${s.display_name.toLowerCase()}`,
        label: `Weekly · ${s.display_name}`,
        usedPct: pct,
        resetsAt: isoToMs(s.resets_at),
        source: 'claude-usage'
      })
    }
  }
  return out
}

/**
 * The JSON Claude Code passes to a status line script (code.claude.com/docs/en/statusline):
 * `rate_limits.five_hour|seven_day.{used_percentage 0-100, resets_at epoch seconds}`.
 */
export function parseClaudeStatusLine(input: unknown): LimitReading[] {
  const limits = (input as { rate_limits?: Record<string, unknown> } | null)?.rate_limits
  if (!limits || typeof limits !== 'object') return []
  const out: LimitReading[] = []
  for (const key of MAIN_WINDOWS) {
    const w = limits[key] as { used_percentage?: unknown; resets_at?: unknown } | undefined
    const pct = pctOf(w?.used_percentage)
    if (w && pct !== null) {
      out.push({ window: key, label: WINDOW_LABELS[key] as string, usedPct: pct, resetsAt: secondsToMs(w.resets_at), source: 'claude-statusline' })
    }
  }
  return out
}

export interface CodexWindow {
  usedPercent: number
  windowDurationMins: number | null
  /** Unix seconds. */
  resetsAt: number | null
}

export interface CodexSnapshot {
  limitId: string | null
  limitName: string | null
  primary: CodexWindow | null
  secondary: CodexWindow | null
}

/** Which of Atelier's windows a Codex window is, from its length: 5 hours, a week, or another. */
function codexWindowId(minutes: number | null, fallback: string): { window: string; label: string } {
  if (minutes !== null && Math.abs(minutes - 300) <= 5) return { window: FIVE_HOUR, label: WINDOW_LABELS[FIVE_HOUR] as string }
  if (minutes !== null && Math.abs(minutes - 10_080) <= 60) return { window: SEVEN_DAY, label: WINDOW_LABELS[SEVEN_DAY] as string }
  if (minutes !== null) {
    const label = minutes % 1440 === 0 ? `${minutes / 1440}-day window` : minutes % 60 === 0 ? `${minutes / 60}-hour window` : `${minutes}-minute window`
    return { window: `codex:${minutes}m`, label }
  }
  return { window: `codex:${fallback}`, label: fallback === 'primary' ? 'Primary window' : 'Secondary window' }
}

/**
 * Codex's rate-limit snapshot (`account/rateLimits/read` or `…/updated`). Plans without a
 * 5-hour window simply report no primary; the 5-hour gauge then stays unavailable.
 * Extra buckets (per model) get their own windows, named after the bucket.
 */
export function parseCodexRateLimits(main: CodexSnapshot | null, byId: Record<string, CodexSnapshot | undefined> | null = null): LimitReading[] {
  const out: LimitReading[] = []
  const add = (snapshot: CodexSnapshot, prefix: string | null) => {
    for (const [slot, w] of [
      ['primary', snapshot.primary],
      ['secondary', snapshot.secondary]
    ] as const) {
      if (!w || pctOf(w.usedPercent) === null) continue
      const id = codexWindowId(w.windowDurationMins, slot)
      out.push({
        window: prefix ? `${prefix}:${id.window}` : id.window,
        label: prefix ? `${id.label} · ${snapshot.limitName ?? prefix}` : id.label,
        usedPct: pctOf(w.usedPercent) as number,
        resetsAt: secondsToMs(w.resetsAt),
        source: 'codex'
      })
    }
  }
  if (main) add(main, null)
  const mainId = main?.limitId ?? 'codex'
  for (const [id, snapshot] of Object.entries(byId ?? {})) {
    if (!snapshot || id === mainId) continue
    add(snapshot, `bucket:${id}`)
  }
  return out
}

/** Two readings belong to the same window period when their resets are within a few minutes. */
export function samePeriod(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) < 5 * 60_000
}

/**
 * Points a window grew by between two readings. A newer reset time means the window started
 * over, so everything used in the new period counts.
 */
export function windowDelta(previous: { usedPct: number; resetsAt: number | null } | null, next: { usedPct: number; resetsAt: number | null }): number {
  if (!previous) return 0
  if (samePeriod(previous.resetsAt, next.resetsAt)) return Math.max(0, next.usedPct - previous.usedPct)
  if (next.resetsAt !== null && previous.resetsAt !== null && next.resetsAt > previous.resetsAt) return next.usedPct
  return 0
}

export interface Participant {
  sessionId: string
  /** Tokens the session used since the previous reading. */
  tokens: number
}

/**
 * Splits a window's growth between the sessions that ran on the account in the meantime.
 * One session gets it all, as reported (official). Several share it by tokens (estimated);
 * with no token counts, equally.
 */
export function attributeDelta(delta: number, participants: Participant[]): Array<{ sessionId: string; deltaPct: number; badge: 'official' | 'estimated' }> {
  if (delta <= 0 || participants.length === 0) return []
  if (participants.length === 1) return [{ sessionId: (participants[0] as Participant).sessionId, deltaPct: delta, badge: 'official' }]
  const total = participants.reduce((sum, p) => sum + Math.max(0, p.tokens), 0)
  return participants.map((p) => ({
    sessionId: p.sessionId,
    deltaPct: total > 0 ? (delta * Math.max(0, p.tokens)) / total : delta / participants.length,
    badge: 'estimated' as const
  }))
}

/** The thresholds a window crossed going from `before` to `after`, lowest first. */
export function crossedThresholds(before: number | null, after: number, thresholds: number[]): number[] {
  return [...thresholds].sort((a, b) => a - b).filter((t) => after >= t && (before === null || before < t))
}

/** "2 h 05 min", "3 d 4 h", "now": time left until a reset. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now'
  const minutes = Math.ceil(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${String(mins).padStart(2, '0')} min`
  return `${mins} min`
}
