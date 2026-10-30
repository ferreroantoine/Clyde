import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { AgentSessionInfo, AgentStart, ApprovalDecision } from '@shared/agent'
import { invoke, on } from '@/lib/ipc'
import { applyEvent, emptyView, type SessionView } from '@/lib/transcript'
import { notify } from './notifications'
import { AgentTerminalFeed } from '@/lib/agent-terminal'
import { useTerminals } from './terminals'
import { profileById, useProfiles } from './profiles'
import { useLayout } from './layout'

interface AgentsState {
  sessions: Record<string, SessionView>
  /** Session ids, oldest first. */
  order: string[]
  activeId: string | null
  starting: boolean
  /** Unsent composer text by session id; `''` holds what waits for the next session to start. */
  drafts: Record<string, string>
  /** Bumped to move the keyboard focus to the composer. */
  focusTick: number
  setDraft: (id: string, text: string) => void
  /** Appends text to the active session's composer (or the next session's) and focuses it. */
  addToDraft: (text: string) => void
  /** Sends at once to the active session; without one, leaves the text in the composer of the next. */
  sendOrDraft: (text: string) => Promise<void>
  init: () => () => void
  start: (request: AgentStart) => Promise<boolean>
  send: (text: string) => Promise<boolean>
  interrupt: () => Promise<void>
  /** Asks the agent to compact its own conversation (Claude Code /compact, Codex, Clyde's summary). */
  compact: (id: string) => Promise<void>
  /** Ends a session and starts the same agent again with a summary of it. */
  continueWithSummary: (id: string) => Promise<void>
  stop: (id?: string) => Promise<void>
  answer: (requestId: string, decision: ApprovalDecision, message?: string) => Promise<void>
  /** Answers keyed by question text; null skips the questions. */
  answerQuestions: (requestId: string, answers: Record<string, string> | null) => Promise<void>
  select: (id: string | null) => void
  /** Hides an ended session from the panel. */
  dismiss: (id: string) => void
}

export const ENDED_STATUSES = new Set(['stopped', 'error'])

export const useAgents = create<AgentsState>()((set, get) => {
  /** The active session when it can still take messages. */
  const live = () => {
    const id = get().activeId
    const view = id ? get().sessions[id] : undefined
    return view && !ENDED_STATUSES.has(view.info.status) ? id : null
  }

  // Each agent's shell commands also show in a read-only terminal tab named after its account.
  const terminalFeed = new AgentTerminalFeed((sessionId, data) => {
    const info = get().sessions[sessionId]?.info
    const profile = profileById(useProfiles.getState().profiles, info?.profileId)
    useTerminals.getState().agentWrite(sessionId, `Agent · ${profile?.name ?? 'agent'}`, info?.cwd ?? '', data)
  })

  const upsertSession = (info: AgentSessionInfo) => {
    // Chat sessions belong to the Chat view, not to the agent panel.
    if (info.chatId) return
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
    drafts: {},
    focusTick: 0,

    setDraft: (id, text) => set({ drafts: { ...get().drafts, [id]: text } }),

    addToDraft: (text) => {
      const id = live() ?? ''
      const current = get().drafts[id] ?? ''
      const joined = !current ? text : /\s$/.test(current) ? current + text : `${current} ${text}`
      set({ drafts: { ...get().drafts, [id]: joined }, focusTick: get().focusTick + 1 })
      if (!id) set({ activeId: null })
      useLayout.getState().setAgentPanelOpen(true)
    },

    sendOrDraft: async (text) => {
      useLayout.getState().setAgentPanelOpen(true)
      if (live() && (await get().send(text))) return
      get().addToDraft(text)
    },

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
        // The text prepared before the session existed moves to its composer.
        const { ['']: waiting, ...drafts } = get().drafts
        set({ activeId: info.id, drafts: waiting ? { ...drafts, [info.id]: waiting } : drafts })
        return true
      } catch (err) {
        notify.error(t('Could not start the agent'), err)
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
        notify.error(t('Could not send the message'), err)
        return false
      }
    },

    interrupt: async () => {
      const id = get().activeId
      if (!id) return
      await invoke('agent:interrupt', { sessionId: id }).catch((err) => notify.error(t('Could not interrupt the agent'), err))
    },

    compact: async (id) => {
      await invoke('agent:compact', { sessionId: id }).catch((err) => notify.error(t('Could not compact the conversation'), err))
    },

    continueWithSummary: async (id) => {
      set({ starting: true })
      try {
        const info = await invoke('agent:continueWithSummary', { sessionId: id })
        upsertSession(info)
        set({ activeId: info.id })
      } catch (err) {
        notify.error(t('Could not start the new session'), err)
      } finally {
        set({ starting: false })
      }
    },

    stop: async (id = get().activeId ?? undefined) => {
      if (!id) return
      await invoke('agent:stop', { sessionId: id }).catch((err) => notify.error(t('Could not stop the agent'), err))
    },

    answer: async (requestId, decision, message) => {
      const id = get().activeId
      if (!id) return
      await invoke('agent:approve', { sessionId: id, requestId, decision, ...(message ? { message } : {}) }).catch((err) =>
        notify.error(t('Could not answer the request'), err)
      )
    },

    answerQuestions: async (requestId, answers) => {
      const id = get().activeId
      if (!id) return
      await invoke('agent:answerQuestion', { sessionId: id, requestId, answers }).catch((err) => notify.error(t('Could not answer the request'), err))
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
