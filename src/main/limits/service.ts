import type { AgentSessionInfo } from '@shared/agent'
import {
  attributeDelta,
  crossedThresholds,
  FIVE_HOUR,
  MAIN_WINDOWS,
  samePeriod,
  SEVEN_DAY,
  WINDOW_LABELS,
  windowDelta,
  type LimitAlert,
  type LimitHistory,
  type LimitReading,
  type ProfileLimits,
  type SessionLimitUsage,
  type WindowState
} from '@shared/limits'
import type { Profile } from '@shared/profiles'
import type { Db } from '../services/db/database'

const DAY = 86_400_000

interface Current {
  usedPct: number
  resetsAt: number | null
  label: string
  source: LimitReading['source']
  at: number
}

export interface LimitsDeps {
  profiles: () => Profile[]
  activeSessions: () => AgentSessionInfo[]
  thresholds: () => { fiveHour: number[]; sevenDay: number[] }
  onProfile: (limits: ProfileLimits) => void
  onSession: (sessionId: string, usage: SessionLimitUsage[]) => void
  onAlert: (alert: LimitAlert) => void
  now?: () => number
}

/**
 * Keeps each subscription account's latest limit readings, stores every reading, and splits
 * each window's growth between the sessions that ran on the account in the meantime.
 */
export class LimitsService {
  private readonly current = new Map<string, Map<string, Current>>()
  /** Tokens per session since the last reading, per account and window. */
  private readonly pending = new Map<string, Map<string, Map<string, number>>>()

  constructor(
    private readonly db: Db,
    private readonly deps: LimitsDeps
  ) {
    this.load()
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** The latest reading of each window, so gauges show something right after a restart. */
  private load(): void {
    const rows = this.db
      .prepare(
        `SELECT s.profile_id, s.window, s.label, s.used_pct, s.resets_at, s.source, s.at FROM limit_snapshots s
         JOIN (SELECT profile_id, window, MAX(id) AS id FROM limit_snapshots GROUP BY profile_id, window) l ON l.id = s.id`
      )
      .all() as Array<{ profile_id: string; window: string; label: string; used_pct: number; resets_at: number | null; source: string; at: number }>
    for (const r of rows) {
      this.windows(r.profile_id).set(r.window, {
        usedPct: r.used_pct,
        resetsAt: r.resets_at,
        label: r.label,
        source: r.source as LimitReading['source'],
        at: r.at
      })
    }
  }

  private windows(profileId: string): Map<string, Current> {
    let m = this.current.get(profileId)
    if (!m) this.current.set(profileId, (m = new Map()))
    return m
  }

  /** A session finished a turn: its tokens count toward its share of the next readings. */
  onTurnEnd(profileId: string, sessionId: string, tokens: number): void {
    let byWindow = this.pending.get(profileId)
    if (!byWindow) this.pending.set(profileId, (byWindow = new Map()))
    const windows = new Set<string>([...MAIN_WINDOWS, ...this.windows(profileId).keys()])
    for (const w of windows) {
      let sessions = byWindow.get(w)
      if (!sessions) byWindow.set(w, (sessions = new Map()))
      sessions.set(sessionId, (sessions.get(sessionId) ?? 0) + tokens)
    }
  }

  /** New readings for an account, from a session (`sessionId`) or a background check. */
  ingest(profileId: string, readings: LimitReading[], sessionId: string | null = null): void {
    if (readings.length === 0) return
    const at = this.now()
    const windows = this.windows(profileId)
    const touched = new Map<string, SessionLimitUsage[]>()
    const insert = this.db.prepare(
      `INSERT INTO limit_snapshots (profile_id, session_id, at, source, window, label, used_pct, resets_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const upsert = this.db.prepare(
      `INSERT INTO session_limit_usage (session_id, window, label, delta_pct, badge) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, window) DO UPDATE SET delta_pct = delta_pct + excluded.delta_pct,
         badge = CASE WHEN session_limit_usage.badge = 'estimated' OR excluded.badge = 'estimated' THEN 'estimated' ELSE 'official' END`
    )
    this.db.transaction(() => {
      for (const r of readings) {
        const previous = windows.get(r.window) ?? null
        insert.run(profileId, sessionId, at, r.source, r.window, r.label, r.usedPct, r.resetsAt)
        const delta = windowDelta(previous, r)
        const shares = attributeDelta(delta, this.participants(profileId, r.window, sessionId))
        for (const share of shares) {
          upsert.run(share.sessionId, r.window, r.label, share.deltaPct, share.badge)
          touched.set(share.sessionId, [])
        }
        // Usage before this reading is accounted for (or, for a first reading, not measurable).
        this.pending.get(profileId)?.get(r.window)?.clear()
        windows.set(r.window, { usedPct: r.usedPct, resetsAt: r.resetsAt, label: r.label, source: r.source, at })
        this.checkAlerts(profileId, previous, r)
      }
    })()
    for (const id of touched.keys()) this.deps.onSession(id, this.sessionUsage(id))
    this.deps.onProfile(this.profileLimits(profileId))
  }

  /**
   * Sessions that used the account since the window's last reading. When none recorded tokens
   * yet (the reading came mid-turn), the reporting session, or the only running one, gets it.
   */
  private participants(profileId: string, window: string, sessionId: string | null) {
    const pending = this.pending.get(profileId)?.get(window)
    if (pending && pending.size > 0) return [...pending.entries()].map(([id, tokens]) => ({ sessionId: id, tokens }))
    if (sessionId) return [{ sessionId, tokens: 0 }]
    const running = this.deps.activeSessions().filter((s) => s.profileId === profileId && s.status === 'running')
    return running.length === 1 ? [{ sessionId: (running[0] as AgentSessionInfo).id, tokens: 0 }] : []
  }

  private checkAlerts(profileId: string, previous: Current | null, r: LimitReading): void {
    const { fiveHour, sevenDay } = this.deps.thresholds()
    const thresholds = r.window === FIVE_HOUR ? fiveHour : r.window === SEVEN_DAY ? sevenDay : []
    const before = previous && samePeriod(previous.resetsAt, r.resetsAt) ? previous.usedPct : null
    const crossed = crossedThresholds(before, r.usedPct, thresholds)
    if (crossed.length === 0) return
    // One alert per threshold and window period, even across restarts.
    const period = r.resetsAt === null ? 0 : Math.round(r.resetsAt / 60_000)
    const record = this.db.prepare(
      'INSERT OR IGNORE INTO limit_alerts (profile_id, window, period, threshold, at) VALUES (?, ?, ?, ?, ?)'
    )
    const highest = crossed.filter((t) => record.run(profileId, r.window, period, t, this.now()).changes > 0).at(-1)
    if (highest === undefined) return
    const profile = this.deps.profiles().find((p) => p.id === profileId)
    this.deps.onAlert({
      profileId,
      profileName: profile?.name ?? 'Account',
      window: r.window,
      label: r.label,
      threshold: highest,
      usedPct: r.usedPct,
      resetsAt: r.resetsAt
    })
  }

  /** Gauges for one account: 5-hour and weekly always, then any extra window it reported. */
  profileLimits(profileId: string): ProfileLimits {
    const windows = this.windows(profileId)
    const now = this.now()
    const state = (id: string, c: Current | undefined, label: string): WindowState => {
      // A window whose reset has passed no longer says anything about the current period.
      if (!c || (c.resetsAt !== null && c.resetsAt <= now)) {
        return { window: id, label: c?.label ?? label, usedPct: null, resetsAt: null, badge: 'unavailable', source: c?.source ?? null, at: c?.at ?? null }
      }
      return { window: id, label: c.label, usedPct: c.usedPct, resetsAt: c.resetsAt, badge: 'official', source: c.source, at: c.at }
    }
    const main = MAIN_WINDOWS.map((w) => state(w, windows.get(w), WINDOW_LABELS[w] as string))
    const extra = [...windows.entries()]
      .filter(([w]) => !(MAIN_WINDOWS as readonly string[]).includes(w))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([w, c]) => state(w, c, c.label))
      .filter((s) => s.badge !== 'unavailable')
    const ats = [...windows.values()].map((c) => c.at)
    return { profileId, windows: [...main, ...extra], updatedAt: ats.length ? Math.max(...ats) : null }
  }

  allProfileLimits(): ProfileLimits[] {
    return this.deps
      .profiles()
      .filter((p) => p.auth === 'subscription')
      .map((p) => this.profileLimits(p.id))
  }

  sessionUsage(sessionId: string): SessionLimitUsage[] {
    const rows = this.db
      .prepare('SELECT window, label, delta_pct, badge FROM session_limit_usage WHERE session_id = ? ORDER BY window')
      .all(sessionId) as Array<{ window: string; label: string; delta_pct: number; badge: string }>
    const rank = (w: string) => ((MAIN_WINDOWS as readonly string[]).indexOf(w) + 3) % 3
    return rows
      .map((r) => ({ window: r.window, label: r.label, deltaPct: Math.round(r.delta_pct * 100) / 100, badge: r.badge as SessionLimitUsage['badge'] }))
      .sort((a, b) => rank(a.window) - rank(b.window))
  }

  /** Readings of the 5-hour and weekly windows over the last days, for the chart. */
  history(profileId: string, days = 7): LimitHistory {
    const since = this.now() - days * DAY
    const rows = this.db
      .prepare(`SELECT window, label, at, used_pct FROM limit_snapshots WHERE profile_id = ? AND at >= ? AND window IN (?, ?) ORDER BY at`)
      .all(profileId, since, FIVE_HOUR, SEVEN_DAY) as Array<{ window: string; label: string; at: number; used_pct: number }>
    return {
      profileId,
      series: MAIN_WINDOWS.map((w) => ({
        window: w,
        label: WINDOW_LABELS[w] as string,
        points: rows.filter((r) => r.window === w).map((r) => ({ at: r.at, usedPct: r.used_pct }))
      }))
    }
  }
}
