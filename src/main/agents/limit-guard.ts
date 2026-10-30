import { isBusy, isEnded, type AgentEvent, type AgentEventEnvelope, type AgentSessionInfo, type LimitAction } from '@shared/agent'
import { FIVE_HOUR, SEVEN_DAY, type ProfileLimits } from '@shared/limits'
import type { Profile } from '@shared/profiles'
import type { Db } from '../services/db/database'
import type { Logger } from '../logger'

/** Told to a session when its account's limit has reset, or after it moved to another account. */
export const LIMIT_CONTINUE_MESSAGE = 'The usage limit that stopped you has reset. Continue the task where you left off.'
export const SWITCH_CONTINUE_MESSAGE = 'You now run on another account because the previous one hit its usage limit. Continue the task where you left off.'
/** Told to a session the user moved to another account or model. */
export const MOVED_CONTINUE_MESSAGE = 'You now run on another account or model. Continue the task where you left off.'

/** Without a known reset time, Clyde tries again after this long. */
export const RETRY_WITHOUT_RESET_MS = 30 * 60 * 1000
/** Some slack after the announced reset. */
export const AFTER_RESET_MS = 60 * 1000
/** An account this full is not a good place to move to. */
export const FULL_PCT = 95

export interface LimitGuardDeps {
  db: Db
  settings: () => { onLimit: LimitAction; fallbackProfiles: string[] }
  profiles: () => Profile[]
  limits: (profileId: string) => ProfileLimits
  sessions: {
    get(sessionId: string): AgentSessionInfo | null
    resume(sessionId: string): Promise<AgentSessionInfo>
    send(sessionId: string, text: string): void
    switchTo(sessionId: string, target: { profileId: string }): Promise<AgentSessionInfo>
    note(sessionId: string, event: AgentEvent): void
  }
  /** A scheduled resume was set (`at`, ms) or cleared (null). */
  onScheduled: (sessionId: string, at: number | null) => void
  log: Logger
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/**
 * Watches sessions for usage limits. When an account hits one mid-task, the turn ends; the guard
 * then tells the panel (which offers to switch or wait), and, as Settings › Agents says, waits for
 * the reset and tells the session to carry on, or moves it to the first fallback account with room.
 * Scheduled resumes are kept in the database, so they survive a restart.
 */
export class LimitGuard {
  /** Sessions that hit a limit during the running turn, with the reset time when known. */
  private readonly hit = new Map<string, number | null>()
  private readonly timers = new Map<string, unknown>()

  constructor(private readonly deps: LimitGuardDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  onEvent({ sessionId, event }: AgentEventEnvelope): void {
    if (event.type === 'rate_limit' && event.status === 'rejected') {
      // Claude Code reports the reset in seconds; a later report without one keeps the earlier.
      const resetsAt = event.resetsAt ? event.resetsAt * 1000 : null
      this.hit.set(sessionId, resetsAt ?? this.hit.get(sessionId) ?? null)
    } else if (event.type === 'turn_end' && this.hit.has(sessionId)) {
      const resetsAt = this.hit.get(sessionId) ?? null
      this.hit.delete(sessionId)
      void this.limitReached(sessionId, resetsAt).catch((err) => this.deps.log.warn(`limit handling failed for ${sessionId}`, err))
    } else if (event.type === 'user' && this.timers.has(sessionId)) {
      // The user took over: no automatic "continue" on top of their message.
      this.cancel(sessionId)
    }
  }

  /** When the account's limit resets: the CLI's report, else the fullest main window's reset. */
  resetTime(profileId: string, reported: number | null): number | null {
    if (reported && reported > this.now()) return reported
    const windows = this.deps.limits(profileId).windows.filter((w) => w.resetsAt && w.resetsAt > this.now() && (w.window === FIVE_HOUR || w.window === SEVEN_DAY))
    const full = windows.filter((w) => (w.usedPct ?? 0) >= FULL_PCT)
    const pick = (full.length ? full : windows).sort((a, b) => (a.resetsAt ?? 0) - (b.resetsAt ?? 0))
    // A full weekly window outlasts the 5-hour one: the latest full reset is the one that matters.
    return (full.length ? pick.at(-1) : pick[0])?.resetsAt ?? null
  }

  /** The first fallback account (Settings order) that is usable and not near its limits. */
  fallbackFor(profileId: string): Profile | null {
    const profiles = this.deps.profiles()
    for (const id of this.deps.settings().fallbackProfiles) {
      const profile = profiles.find((p) => p.id === id)
      if (!profile || profile.id === profileId || !profile.usable) continue
      const full = this.deps.limits(profile.id).windows.some((w) => (w.usedPct ?? 0) >= FULL_PCT && (w.window === FIVE_HOUR || w.window === SEVEN_DAY))
      if (!full) return profile
    }
    return null
  }

  private async limitReached(sessionId: string, reported: number | null): Promise<void> {
    const info = this.deps.sessions.get(sessionId)
    if (!info) return
    const resetsAt = this.resetTime(info.profileId, reported)
    this.deps.sessions.note(sessionId, { type: 'limit_reached', resetsAt })
    const action = this.deps.settings().onLimit
    if (action === 'switch') {
      const target = this.fallbackFor(info.profileId)
      if (target) {
        await this.switchTo(sessionId, target.id)
        return
      }
      this.deps.log.info(`no fallback account for ${sessionId}; waiting for the reset instead`)
    }
    if (action !== 'ask') this.schedule(sessionId, resetsAt ? resetsAt + AFTER_RESET_MS : this.now() + RETRY_WITHOUT_RESET_MS)
  }

  /** Moves the session to another account and tells it to carry on. */
  async switchTo(sessionId: string, profileId: string): Promise<AgentSessionInfo> {
    this.cancel(sessionId)
    const info = await this.deps.sessions.switchTo(sessionId, { profileId })
    this.deps.sessions.send(sessionId, SWITCH_CONTINUE_MESSAGE)
    return info
  }

  /** Tells the session to carry on at `at` (ms); null uses the account's reset time. */
  schedule(sessionId: string, at: number | null = null): number {
    const info = this.deps.sessions.get(sessionId)
    const when = at ?? (info ? this.resetTime(info.profileId, null) : null)
    const time = when ? Math.max(when, this.now()) : this.now() + RETRY_WITHOUT_RESET_MS
    this.deps.db
      .prepare('INSERT INTO scheduled_resumes (session_id, at, created_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET at = excluded.at')
      .run(sessionId, time, this.now())
    this.arm(sessionId, time)
    this.deps.onScheduled(sessionId, time)
    return time
  }

  cancel(sessionId: string): void {
    const timer = this.timers.get(sessionId)
    if (timer !== undefined) (this.deps.clearTimer ?? clearTimeout)(timer as never)
    this.timers.delete(sessionId)
    const removed = this.deps.db.prepare('DELETE FROM scheduled_resumes WHERE session_id = ?').run(sessionId).changes
    if (removed || timer !== undefined) this.deps.onScheduled(sessionId, null)
  }

  /** Resumes planned before a restart; those already due run right away. */
  restore(): void {
    const rows = this.deps.db.prepare('SELECT session_id, at FROM scheduled_resumes').all() as Array<{ session_id: string; at: number }>
    for (const row of rows) this.arm(row.session_id, row.at)
  }

  scheduled(): Array<{ sessionId: string; at: number }> {
    return (this.deps.db.prepare('SELECT session_id, at FROM scheduled_resumes ORDER BY at').all() as Array<{ session_id: string; at: number }>).map((r) => ({
      sessionId: r.session_id,
      at: r.at
    }))
  }

  dispose(): void {
    for (const timer of this.timers.values()) (this.deps.clearTimer ?? clearTimeout)(timer as never)
    this.timers.clear()
  }

  private arm(sessionId: string, at: number): void {
    const previous = this.timers.get(sessionId)
    if (previous !== undefined) (this.deps.clearTimer ?? clearTimeout)(previous as never)
    // setTimeout holds at most ~24.8 days.
    const delay = Math.min(Math.max(0, at - this.now()), 2 ** 31 - 1)
    this.timers.set(sessionId, (this.deps.setTimer ?? setTimeout)(() => void this.fire(sessionId), delay))
  }

  private async fire(sessionId: string): Promise<void> {
    this.timers.delete(sessionId)
    this.deps.db.prepare('DELETE FROM scheduled_resumes WHERE session_id = ?').run(sessionId)
    this.deps.onScheduled(sessionId, null)
    try {
      const info = this.deps.sessions.get(sessionId)
      // Already working again (the user wrote to it): nothing to add.
      if (info && isBusy(info.status)) return
      if (!info || isEnded(info.status)) await this.deps.sessions.resume(sessionId)
      this.deps.sessions.send(sessionId, LIMIT_CONTINUE_MESSAGE)
    } catch (err) {
      this.deps.log.warn(`could not resume ${sessionId} after its limit`, err)
    }
  }
}
