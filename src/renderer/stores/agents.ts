import { create } from 'zustand'
import type { AgentSessionInfo, AgentStart, ApprovalDecision } from '@shared/agent'
import { invoke, on } from '@/lib/ipc'
import { applyEvent, emptyView, type SessionView } from '@/lib/transcript'
import { notify } from './notifications'
import { AgentTerminalFeed } from '@/lib/agent-terminal'
import { useTerminals } from './terminals'
import { profileById, useProfiles } from './profiles'

interface AgentsState {
  sessions: Record<string, SessionView>
  /** Session ids, oldest first. */
  order: string[]
  activeId: string | null
  starting: boolean
  init: () => () => void
  start: (request: AgentStart) => Promise<boolean>
  send: (text: string) => Promise<boolean>
  interrupt: () => Promise<void>
  stop: (id?: string) => Promise<void>
  answer: (requestId: string, decision: ApprovalDecision, message?: string) => Promise<void>
  select: (id: string | null) => void
  /** Hides an ended session from the panel. */
  dismiss: (id: string) => void
}

export const ENDED_STATUSES = new Set(['stopped', 'error'])

export const useAgents = create<AgentsState>()((set, get) => {
  // Each agent's shell commands also show in a read-only terminal tab named after its account.
  const terminalFeed = new AgentTerminalFeed((sessionId, data) => {
    const info = get().sessions[sessionId]?.info
    const profile = profileById(useProfiles.getState().profiles, info?.profileId)
    useTerminals.getState().agentWrite(sessionId, `Agent · ${profile?.name ?? 'agent'}`, info?.cwd ?? '', data)
  })

  const upsertSession = (info: AgentSessionInfo) => {
    const { sessions, order } = get()
    const current = sessions[info.id]
    set({
      sessions: { ...sessions, [info.id]: current ? { ...current, info } : emptyView(info) },
      order: current ? order : [...order, info.id]
    })
  }

  return {
    sessions: {},
    order: [],
    activeId: null,
    starting: false,

    init: () => {
      const offs = [
        on('agent:session', upsertSession),
        on('agent:event', (envelope) => {
          const view = get().sessions[envelope.sessionId]
          if (!view) return
          set({ sessions: { ...get().sessions, [envelope.sessionId]: applyEvent(view, envelope) } })
          terminalFeed.feed(envelope)
        })
      ]
      invoke('agent:list')
        .then((list) => list.forEach(upsertSession))
        .catch(() => undefined)
      return () => offs.forEach((off) => off())
    },

    start: async (request) => {
      set({ starting: true })
      try {
        const info = await invoke('agent:start', request)
        upsertSession(info)
        set({ activeId: info.id })
        return true
      } catch (err) {
        notify.error('Could not start the agent', err)
        return false
      } finally {
        set({ starting: false })
      }
    },

    send: async (text) => {
      const id = get().activeId
      if (!id) return false
      try {
        await invoke('agent:send', { sessionId: id, text })
        return true
      } catch (err) {
        notify.error('Could not send the message', err)
        return false
      }
    },

    interrupt: async () => {
      const id = get().activeId
      if (!id) return
      await invoke('agent:interrupt', { sessionId: id }).catch((err) => notify.error('Could not interrupt the agent', err))
    },

    stop: async (id = get().activeId ?? undefined) => {
      if (!id) return
      await invoke('agent:stop', { sessionId: id }).catch((err) => notify.error('Could not stop the agent', err))
    },

    answer: async (requestId, decision, message) => {
      const id = get().activeId
      if (!id) return
      await invoke('agent:approve', { sessionId: id, requestId, decision, ...(message ? { message } : {}) }).catch((err) =>
        notify.error('Could not answer the request', err)
      )
    },

    select: (id) => set({ activeId: id }),

    dismiss: (id) => {
      const { [id]: _removed, ...sessions } = get().sessions
      set({
        sessions,
        order: get().order.filter((o) => o !== id),
        activeId: get().activeId === id ? null : get().activeId
      })
    }
  }
})
