import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSessionInfo, LimitAction } from '@shared/agent'
import { FIVE_HOUR, SEVEN_DAY, type ProfileLimits } from '@shared/limits'
import type { Profile } from '@shared/profiles'
import { migrate } from '../services/db/database'
import { AFTER_RESET_MS, LIMIT_CONTINUE_MESSAGE, LimitGuard, RETRY_WITHOUT_RESET_MS, SWITCH_CONTINUE_MESSAGE } from './limit-guard'

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const HOUR = 60 * 60 * 1000
const START = 1_800_000_000_000

function setup({ onLimit = 'ask' as LimitAction, fallbackProfiles = [] as string[], db = new Database(':memory:') } = {}) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name = 'scheduled_resumes'").get()) migrate(db)
  let now = START
  const timers: Array<{ at: number; fn: () => void; done: boolean }> = []
  const profiles = [
    { id: 'work', name: 'Work', usable: true },
    { id: 'perso', name: 'Perso', usable: true },
    { id: 'spare', name: 'Spare', usable: true }
  ] as Profile[]
  const usage: Record<string, ProfileLimits['windows']> = {}
  const infos = new Map<string, AgentSessionInfo>([['s1', { id: 's1', profileId: 'work', status: 'idle' } as AgentSessionInfo]])
  const sent: string[] = []
  const notes: AgentEvent[] = []
  const scheduled: Array<number | null> = []
  const sessions = {
    get: (id: string) => infos.get(id) ?? null,
    resume: vi.fn(async (id: string) => {
      const info = { ...(infos.get(id) as AgentSessionInfo), status: 'idle' as const }
      infos.set(id, info)
      return info
    }),
    send: (_id: string, text: string) => void sent.push(text),
    switchTo: vi.fn(async (id: string, target: { profileId: string }) => {
      const info = { ...(infos.get(id) as AgentSessionInfo), profileId: target.profileId }
      infos.set(id, info)
      return info
    }),
    note: (_id: string, event: AgentEvent) => void notes.push(event)
  }
  const guard = new LimitGuard({
    db: db as never,
    settings: () => ({ onLimit, fallbackProfiles }),
    profiles: () => profiles,
    limits: (id) => ({ profileId: id, windows: usage[id] ?? [] }) as unknown as ProfileLimits,
    sessions,
    onScheduled: (_id, at) => void scheduled.push(at),
    log,
    now: () => now,
    setTimer: (fn, ms) => {
      const timer = { at: now + ms, fn, done: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => void ((timer as { done: boolean }).done = true)
  })
  /** Moves the clock and runs the timers that came due. */
  const advance = async (ms: number) => {
    now += ms
    for (const timer of timers.filter((t) => !t.done && t.at <= now)) {
      timer.done = true
      timer.fn()
    }
    await vi.waitFor(() => undefined)
    await new Promise((r) => setTimeout(r, 0))
  }
  const hit = async (resetsAt: number | null) => {
    guard.onEvent({ sessionId: 's1', seq: 1, event: { type: 'rate_limit', status: 'rejected', resetsAt: resetsAt === null ? null : resetsAt / 1000, utilization: null, limitType: null } as AgentEvent })
    guard.onEvent({ sessionId: 's1', seq: 2, event: { type: 'turn_end' } as AgentEvent })
    await new Promise((r) => setTimeout(r, 0))
  }
  return { guard, db, infos, usage, sent, notes, scheduled, sessions, advance, hit, now: () => now }
}

describe('LimitGuard', () => {
  it('only tells the panel when the setting is to ask', async () => {
    const { guard, hit, notes, scheduled } = setup()
    await hit(START + 2 * HOUR)
    expect(notes).toEqual([{ type: 'limit_reached', resetsAt: START + 2 * HOUR }])
    expect(scheduled).toEqual([])
    expect(guard.scheduled()).toEqual([])
  })

  it('waits for the reset, then tells the session to carry on', async () => {
    const { guard, hit, advance, sent, scheduled } = setup({ onLimit: 'wait' })
    await hit(START + 2 * HOUR)
    const at = START + 2 * HOUR + AFTER_RESET_MS
    expect(guard.scheduled()).toEqual([{ sessionId: 's1', at }])
    await advance(2 * HOUR)
    expect(sent).toEqual([])
    await advance(AFTER_RESET_MS)
    expect(sent).toEqual([LIMIT_CONTINUE_MESSAGE])
    expect(scheduled).toEqual([at, null])
    expect(guard.scheduled()).toEqual([])
  })

  it('takes the reset of the full window when the CLI gave none', async () => {
    const { guard, hit, usage } = setup({ onLimit: 'wait' })
    usage['work'] = [
      { window: FIVE_HOUR, usedPct: 40, resetsAt: START + HOUR },
      { window: SEVEN_DAY, usedPct: 100, resetsAt: START + 30 * HOUR }
    ] as ProfileLimits['windows']
    await hit(null)
    expect(guard.scheduled()[0]?.at).toBe(START + 30 * HOUR + AFTER_RESET_MS)
  })

  it('tries again later when no reset time is known', async () => {
    const { guard, hit } = setup({ onLimit: 'wait' })
    await hit(null)
    expect(guard.scheduled()[0]?.at).toBe(START + RETRY_WITHOUT_RESET_MS)
  })

  it('switches to the first fallback account with room', async () => {
    const { hit, usage, sessions, sent } = setup({ onLimit: 'switch', fallbackProfiles: ['work', 'perso', 'spare'] })
    usage['perso'] = [{ window: FIVE_HOUR, usedPct: 97, resetsAt: START + HOUR }] as ProfileLimits['windows']
    await hit(START + HOUR)
    expect(sessions.switchTo).toHaveBeenCalledWith('s1', { profileId: 'spare' })
    expect(sent).toEqual([SWITCH_CONTINUE_MESSAGE])
  })

  it('waits instead when every fallback account is full', async () => {
    const { guard, hit, usage, sessions } = setup({ onLimit: 'switch', fallbackProfiles: ['perso'] })
    usage['perso'] = [{ window: SEVEN_DAY, usedPct: 100, resetsAt: START + 50 * HOUR }] as ProfileLimits['windows']
    await hit(START + HOUR)
    expect(sessions.switchTo).not.toHaveBeenCalled()
    expect(guard.scheduled()).toHaveLength(1)
  })

  it('drops the planned resume when the user writes to the session', async () => {
    const { guard, hit, advance, sent } = setup({ onLimit: 'wait' })
    await hit(START + HOUR)
    guard.onEvent({ sessionId: 's1', seq: 3, event: { type: 'user', id: 'u1', text: 'never mind' } })
    expect(guard.scheduled()).toEqual([])
    await advance(2 * HOUR)
    expect(sent).toEqual([])
  })

  it('resumes an ended session, and keeps planned resumes across a restart', async () => {
    const db = new Database(':memory:')
    const first = setup({ onLimit: 'wait', db })
    await first.hit(START + HOUR)
    first.guard.dispose()

    const second = setup({ db })
    second.infos.set('s1', { id: 's1', profileId: 'work', status: 'interrupted' } as AgentSessionInfo)
    second.guard.restore()
    await second.advance(HOUR + AFTER_RESET_MS)
    expect(second.sessions.resume).toHaveBeenCalledWith('s1')
    expect(second.sent).toEqual([LIMIT_CONTINUE_MESSAGE])
  })
})
