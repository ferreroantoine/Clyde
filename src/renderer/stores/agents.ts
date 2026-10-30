import { create } from 'zustand'
import { t } from '@shared/i18n'
import { ENDED_STATUSES as ENDED, type AgentSessionInfo, type AgentStart, type ApprovalDecision, type SessionSummary } from '@shared/agent'
import { invoke, on } from '@/lib/ipc'
import { applyEvent, emptyView, type SessionView } from '@/lib/transcript'
import { useWorkspace } from './workspace'
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
  /** Recent sessions of the open project, live or ended, newest first. */
  history: SessionSummary[]
  loadHistory: () => Promise<void>
  /** Shows a session from the history (its stored transcript) in the panel. */
  open: (id: string) => Promise<void>
  /** Brings an ended session back; `carryOn` also tells it to finish what it was doing. */
  resume: (id: string, carryOn?: boolean) => Promise<boolean>
  resuming: string | null
}

export const ENDED_STATUSES: ReadonlySet<string> = ENDED

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
    const { sessions, order, history } = get()
    const current = sessions[info.id]
    // The history list follows live sessions of the open project.
    const known = history.some((h) => h.id === info.id)
    const root = useWorkspace.getState().info?.root
    const summary = (h?: SessionSummary): SessionSummary => ({
      id: info.id,
      profileId: info.profileId,
      kind: info.kind,
      model: info.model,
      title: h?.title ?? null,
      status: info.status,
      cwd: info.cwd,
      taskId: info.taskId,
      startedAt: info.createdAt,
      endedAt: ENDED.has(info.status) ? Date.now() : null,
      resumable: true
    })
    set({
      sessions: { ...sessions, [info.id]: current ? { ...current, info } : emptyView(info) },
      order: current ? order : [...order, info.id],
      history: known ? history.map((h) => (h.id === info.id ? summary(h) : h)) : info.cwd === root ? [summary(), ...history] : history
    })
  }

  return {
    sessions: {},
    order: [],
    activeId: null,
    starting: false,
    drafts: {},
    focusTick: 0,
    history: [],
    resuming: null,

    loadHistory: async () => {
      const root = useWorkspace.getState().info?.root
      if (!root) return set({ history: [] })
      try {
        set({ history: await invoke('agent:history', { cwd: root }) })
      } catch {
        // The list is a convenience; the panel works without it.
      }
    },

    open: async (id) => {
      if (get().sessions[id]) return set({ activeId: id })
      try {
        const stored = await invoke('agent:load', { sessionId: id })
        let view: SessionView = { ...emptyView(stored.info), resumable: stored.resumable }
        for (const envelope of stored.events) view = applyEvent(view, envelope)
        // Stored status events may lag behind the session's real state.
        view = { ...view, info: stored.info }
        set({ sessions: { ...get().sessions, [id]: view }, order: [...get().order.filter((o) => o !== id), id], activeId: id })
      } catch (err) {
        notify.error(t('Could not open the session'), err)
      }
    },

    resume: async (id, carryOn = false) => {
      set({ resuming: id })
      try {
        await invoke('agent:resume', { sessionId: id, continue: carryOn })
        set({ activeId: id })
        return true
      } catch (err) {
        notify.error(t('Could not resume the session'), err)
        return false
      } finally {
        set({ resuming: null })
      }
    },

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
          // The first message names the session in the list.
          const { event } = envelope
          if (event.type === 'user' && get().history.some((h) => h.id === envelope.sessionId && !h.title)) {
            set({ history: get().history.map((h) => (h.id === envelope.sessionId && !h.title ? { ...h, title: event.text.trim().slice(0, 120) } : h)) })
          }
          terminalFeed.feed(envelope)
        })
      ]
      invoke('agent:list')
        .then((list) => list.forEach(upsertSession))
        .catch(() => undefined)
      void get().loadHistory()
      // Another project: its own sessions.
      const offWorkspace = useWorkspace.subscribe((state, previous) => {
        if (state.info?.root !== previous.info?.root) void get().loadHistory()
      })
      return () => {
        offs.forEach((off) => off())
        offWorkspace()
      }
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
      // Writing in an ended session brings it back first.
      const view = get().sessions[id]
      if (view && ENDED.has(view.info.status)) {
        if (!view.resumable || !(await get().resume(id))) return false
      }
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
