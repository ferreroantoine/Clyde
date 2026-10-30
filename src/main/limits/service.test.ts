import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionInfo } from '@shared/agent'
import type { LimitReading } from '@shared/limits'
import type { Profile } from '@shared/profiles'
import { migrate } from '../services/db/database'
import { LimitsService } from './service'

const H = 3_600_000
const RESET = 1_900_000_000_000

const profile = { id: 'p1', name: 'Claude perso', auth: 'subscription', kind: 'claude-code' } as Profile
const reading = (window: string, usedPct: number, resetsAt = RESET): LimitReading => ({
  window,
  label: window === 'five_hour' ? '5-hour window' : 'Weekly',
  usedPct,
  resetsAt,
  source: 'claude-usage'
})

function setup(active: Partial<AgentSessionInfo>[] = []) {
  const db = new Database(':memory:')
  migrate(db)
  let now = RESET - 2 * H
  const onSession = vi.fn()
  const onProfile = vi.fn()
  const onAlert = vi.fn()
  const deps = {
    profiles: () => [profile],
    activeSessions: () => active as AgentSessionInfo[],
    thresholds: () => ({ fiveHour: [75, 90], sevenDay: [85, 95] }),
    onProfile,
    onSession,
    onAlert,
    now: () => now
  }
  const service = new LimitsService(db, deps)
  return { db, service, deps, onSession, onProfile, onAlert, tick: (ms: number) => (now += ms) }
}

describe('LimitsService', () => {
  it('gives the only session the whole growth, as official', () => {
    const { service } = setup()
    service.ingest('p1', [reading('five_hour', 20), reading('seven_day', 40)])
    service.onTurnEnd('p1', 's1', 5000)
    service.ingest('p1', [reading('five_hour', 23.5), reading('seven_day', 40.8)], 's1')
    expect(service.sessionUsage('s1')).toEqual([
      { window: 'five_hour', label: '5-hour window', deltaPct: 3.5, badge: 'official' },
      { window: 'seven_day', label: 'Weekly', deltaPct: 0.8, badge: 'official' }
    ])
  })

  it('splits growth between concurrent sessions by tokens, as estimated', () => {
    const { service } = setup()
    service.ingest('p1', [reading('five_hour', 10)])
    service.onTurnEnd('p1', 's1', 3000)
    service.onTurnEnd('p1', 's2', 1000)
    service.ingest('p1', [reading('five_hour', 14)], 's2')
    expect(service.sessionUsage('s1')).toEqual([{ window: 'five_hour', label: '5-hour window', deltaPct: 3, badge: 'estimated' }])
    expect(service.sessionUsage('s2')).toEqual([{ window: 'five_hour', label: '5-hour window', deltaPct: 1, badge: 'estimated' }])
    // A later turn of s1 alone adds an official share, but the total stays marked estimated.
    service.onTurnEnd('p1', 's1', 100)
    service.ingest('p1', [reading('five_hour', 15)], 's1')
    expect(service.sessionUsage('s1')[0]).toMatchObject({ deltaPct: 4, badge: 'estimated' })
  })

  it('counts the new period after a reset, and shows a window as unavailable once its reset passed', () => {
    const { service, tick } = setup()
    service.ingest('p1', [reading('five_hour', 88)])
    service.onTurnEnd('p1', 's1', 10)
    service.ingest('p1', [reading('five_hour', 4, RESET + 5 * H)], 's1')
    expect(service.sessionUsage('s1')[0]?.deltaPct).toBe(4)
    tick(8 * H)
    expect(service.profileLimits('p1').windows[0]).toMatchObject({ window: 'five_hour', usedPct: null, badge: 'unavailable' })
    expect(service.profileLimits('p1').windows[1]).toMatchObject({ window: 'seven_day', badge: 'unavailable' })
  })

  it('attributes a background reading to the only running session', () => {
    const { service } = setup([{ id: 's9', profileId: 'p1', status: 'running' }])
    service.ingest('p1', [reading('seven_day', 50)])
    service.ingest('p1', [reading('seven_day', 51)])
    expect(service.sessionUsage('s9')).toEqual([{ window: 'seven_day', label: 'Weekly', deltaPct: 1, badge: 'official' }])
  })

  it('raises each threshold once per period, and keeps state across restarts', () => {
    const { service, db, deps, onAlert } = setup()
    service.ingest('p1', [reading('five_hour', 70)])
    service.ingest('p1', [reading('five_hour', 92)])
    expect(onAlert).toHaveBeenCalledTimes(1)
    expect(onAlert).toHaveBeenCalledWith(expect.objectContaining({ window: 'five_hour', threshold: 90, usedPct: 92, profileName: 'Claude perso' }))
    service.ingest('p1', [reading('five_hour', 95)])
    expect(onAlert).toHaveBeenCalledTimes(1)

    const restarted = new LimitsService(db, deps)
    expect(restarted.profileLimits('p1').windows[0]).toMatchObject({ usedPct: 95, badge: 'official' })
    restarted.ingest('p1', [reading('five_hour', 96)])
    expect(onAlert).toHaveBeenCalledTimes(1)
  })

  it('lists extra windows after the main ones and keeps a 7-day history', () => {
    const { service } = setup()
    service.ingest('p1', [reading('seven_day', 30), { ...reading('model:fable', 12), label: 'Weekly · Fable' }])
    const limits = service.profileLimits('p1')
    expect(limits.windows.map((w) => [w.window, w.badge])).toEqual([
      ['five_hour', 'unavailable'],
      ['seven_day', 'official'],
      ['model:fable', 'official']
    ])
    expect(service.history('p1').series[1]?.points).toEqual([{ at: RESET - 2 * H, usedPct: 30 }])
    expect(service.allProfileLimits()).toHaveLength(1)
  })
})
