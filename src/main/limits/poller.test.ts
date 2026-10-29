import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionInfo } from '@shared/agent'
import type { Profile } from '@shared/profiles'
import { LimitsPoller } from './poller'

const p = (id: string, kind: Profile['kind'], auth: Profile['auth'] = 'subscription') => ({ id, name: id, kind, auth, usable: true }) as Profile

describe('LimitsPoller', () => {
  it('reads idle subscription accounts whose CLI can report limits, at the set interval', async () => {
    vi.useFakeTimers()
    try {
      let now = 0
      const read = vi.fn(async (profile: Profile) => [{ window: 'five_hour', label: '5h', usedPct: profile.id === 'a' ? 10 : 20, resetsAt: null, source: 'codex' as const }])
      const ingest = vi.fn()
      const active: Partial<AgentSessionInfo>[] = [{ profileId: 'b', status: 'running' }]
      const poller = new LimitsPoller({
        profiles: () => [p('a', 'claude-code'), p('b', 'codex'), p('c', 'antigravity'), p('d', 'anthropic', 'api-key')],
        activeSessions: () => active as AgentSessionInfo[],
        intervalMinutes: () => 10,
        read,
        ingest,
        log: vi.fn(),
        now: () => now
      })
      poller.start(0)
      await vi.advanceTimersByTimeAsync(1)
      // b has a running agent, c cannot be read without a prompt, d is an API account.
      expect(read.mock.calls.map(([x]) => x.id)).toEqual(['a'])
      expect(ingest).toHaveBeenCalledWith('a', expect.any(Array))
      now = 5 * 60_000
      await vi.advanceTimersByTimeAsync(60_000)
      expect(read).toHaveBeenCalledTimes(1)
      active.length = 0
      now = 11 * 60_000
      await vi.advanceTimersByTimeAsync(60_000)
      expect(read.mock.calls.map(([x]) => x.id)).toEqual(['a', 'a', 'b'])
      await poller.refresh('b')
      expect(read).toHaveBeenCalledTimes(4)
      poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
