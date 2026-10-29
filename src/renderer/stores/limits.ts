import { create } from 'zustand'
import type { LimitDiagnostic, LimitHistory, ProfileLimits, SessionLimitUsage } from '@shared/limits'
import { invoke, on } from '@/lib/ipc'
import { notify } from './notifications'

interface LimitsState {
  /** Gauges per subscription account. */
  profiles: Record<string, ProfileLimits>
  /** Points of each window per session, loaded on first look. */
  sessions: Record<string, SessionLimitUsage[]>
  history: Record<string, LimitHistory>
  refreshing: boolean
  init: () => () => void
  loadSession: (sessionId: string) => Promise<void>
  loadHistory: (profileId: string) => Promise<void>
  refresh: (profileId?: string) => Promise<void>
  diagnose: (profileId: string) => Promise<LimitDiagnostic[] | null>
}

const byProfile = (list: ProfileLimits[]) => Object.fromEntries(list.map((l) => [l.profileId, l]))

export const useLimits = create<LimitsState>()((set, get) => ({
  profiles: {},
  sessions: {},
  history: {},
  refreshing: false,

  init: () => {
    void invoke('limits:list')
      .then((list) => set({ profiles: byProfile(list) }))
      .catch(() => undefined)
    const offs = [
      on('limits:changed', (l) => {
        set({ profiles: { ...get().profiles, [l.profileId]: l } })
        // The chart follows new readings once it has been opened.
        if (get().history[l.profileId]) void get().loadHistory(l.profileId)
      }),
      on('limits:sessionChanged', ({ sessionId, usage }) => set({ sessions: { ...get().sessions, [sessionId]: usage } })),
      on('limits:alert', (a) =>
        notify.warning(
          `${a.profileName}: ${a.label} at ${Math.round(a.usedPct)}%`,
          a.resetsAt ? `Alert threshold ${a.threshold}%. Resets ${new Date(a.resetsAt).toLocaleString()}.` : `Alert threshold ${a.threshold}%.`
        )
      )
    ]
    return () => offs.forEach((off) => off())
  },

  loadSession: async (sessionId) => {
    if (get().sessions[sessionId]) return
    try {
      const usage = await invoke('limits:session', { sessionId })
      set({ sessions: { ...get().sessions, [sessionId]: usage } })
    } catch {
      // shown as unavailable
    }
  },

  loadHistory: async (profileId) => {
    try {
      const history = await invoke('limits:history', { profileId, days: 7 })
      set({ history: { ...get().history, [profileId]: history } })
    } catch (err) {
      notify.error('Could not load the limit history', err)
    }
  },

  refresh: async (profileId) => {
    set({ refreshing: true })
    try {
      set({ profiles: byProfile(await invoke('limits:refresh', profileId ? { profileId } : {})) })
    } catch (err) {
      notify.error('Could not read the usage limits', err)
    } finally {
      set({ refreshing: false })
    }
  },

  diagnose: async (profileId) => {
    try {
      return await invoke('limits:diagnose', { profileId })
    } catch (err) {
      notify.error('The diagnostic failed', err)
      return null
    }
  }
}))
