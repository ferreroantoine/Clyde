import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { AttachmentInput, ChatLive, ChatMessage, ChatUsage, Conversation } from '@shared/chat'
import { invoke, on } from '@/lib/ipc'
import { applyEvent, emptyView, type SessionView } from '@/lib/transcript'
import { notify } from './notifications'
import { useAgents } from './agents'
import { useLayout } from './layout'
import type { ReasoningEffort } from '@shared/profiles'

/** Who answers a new conversation: a saved agent, or an account and a model. */
export interface ChatTarget {
  agentId: string | null
  profileId: string
  model: string
  /** Reasoning effort; empty is the model's default. */
  effort?: ReasoningEffort | ''
  /** The agent's MCP tools are offered to the model. */
  toolsEnabled?: boolean
}

/** A file waiting in the composer: read in the renderer, or a path from the Explorer. */
export interface PendingAttachment {
  key: string
  name: string
  size: number
  input: AttachmentInput
  /** Data URL for an image preview. */
  preview?: string
}

interface ChatState {
  conversations: Conversation[]
  loaded: boolean
  /** null: a new conversation, created on its first message. */
  activeId: string | null
  messages: Record<string, ChatMessage[]>
  live: Record<string, ChatLive>
  /** The answer being streamed, per session. */
  streams: Record<string, SessionView>
  usage: Record<string, ChatUsage>
  /** Target of the next new conversation. */
  draftTarget: ChatTarget | null
  query: string
  /** Conversation ids matching `query`, or null when not searching. */
  matches: string[] | null
  init: () => () => void
  select: (id: string | null) => Promise<void>
  setDraftTarget: (target: ChatTarget) => void
  send: (text: string, attachments: PendingAttachment[]) => Promise<boolean>
  stop: () => Promise<void>
  regenerate: () => Promise<void>
  edit: (messageId: string, text: string) => Promise<void>
  update: (id: string, fields: Partial<Pick<Conversation, 'title' | 'pinned' | 'agentId' | 'profileId' | 'model' | 'effort' | 'toolsEnabled' | 'useHistory'>>) => Promise<void>
  remove: (id: string) => Promise<void>
  search: (query: string) => Promise<void>
  loadUsage: (id: string) => Promise<void>
  continueInProject: () => Promise<void>
}

export const useChat = create<ChatState>()((set, get) => {
  const fail = (title: string) => (err: unknown) => {
    notify.error(title, err)
  }

  const loadMessages = async (id: string) => {
    const messages = await invoke('chat:messages', { id })
    set({ messages: { ...get().messages, [id]: messages } })
  }

  return {
    conversations: [],
    loaded: false,
    activeId: null,
    messages: {},
    live: {},
    streams: {},
    usage: {},
    draftTarget: null,
    query: '',
    matches: null,

    init: () => {
      const offs = [
        on('chat:changed', (conversations) => {
          set({ conversations })
          if (get().query) void get().search(get().query)
        }),
        on('chat:message', (message) => {
          const list = get().messages[message.conversationId]
          if (!list) return
          const without = list.filter((m) => m.id !== message.id)
          set({ messages: { ...get().messages, [message.conversationId]: [...without, message] } })
          if (message.role === 'assistant') void get().loadUsage(message.conversationId)
        }),
        on('chat:live', (live) => {
          const streams = { ...get().streams }
          // A new turn starts from an empty view; the stored answer replaces it when it ends.
          const view = live.sessionId ? streams[live.sessionId] : undefined
          if (live.sessionId && view && live.busy && !get().live[live.conversationId]?.busy) {
            streams[live.sessionId] = { ...view, items: [] }
          }
          set({ live: { ...get().live, [live.conversationId]: live }, streams })
        }),
        on('agent:session', (info) => {
          if (!info.chatId) return
          const current = get().streams[info.id]
          set({ streams: { ...get().streams, [info.id]: current ? { ...current, info } : emptyView(info) } })
        }),
        on('agent:event', (envelope) => {
          const isChat = Object.values(get().live).some((l) => l.sessionId === envelope.sessionId)
          if (!isChat) return
          const view = get().streams[envelope.sessionId]
          if (!view) return
          // Only the current turn matters here: the user message is already in the list.
          if (envelope.event.type === 'user') {
            set({ streams: { ...get().streams, [envelope.sessionId]: { ...view, items: [] } } })
            return
          }
          set({ streams: { ...get().streams, [envelope.sessionId]: applyEvent(view, envelope) } })
        })
      ]
      invoke('chat:list')
        .then((conversations) => set({ conversations, loaded: true }))
        .catch((err) => {
          set({ loaded: true })
          notify.error(t('Could not load the conversations'), err)
        })
      return () => offs.forEach((off) => off())
    },

    select: async (id) => {
      set({ activeId: id })
      if (!id) return
      try {
        const [, live] = await Promise.all([loadMessages(id), invoke('chat:live', { id })])
        set({ live: { ...get().live, [id]: live } })
        void get().loadUsage(id)
      } catch (err) {
        notify.error(t('Could not open this conversation'), err)
      }
    },

    setDraftTarget: (draftTarget) => set({ draftTarget }),

    send: async (text, attachments) => {
      let id = get().activeId
      try {
        if (!id) {
          const target = get().draftTarget
          if (!target) {
            notify.error(t('Choose who answers first'))
            return false
          }
          const conversation = await invoke('chat:create', target)
          id = conversation.id
          set({ activeId: id, messages: { ...get().messages, [id]: [] }, conversations: [conversation, ...get().conversations] })
        }
        await invoke('chat:send', { id, text, attachments: attachments.map((a) => a.input) })
        if (!get().messages[id]) await loadMessages(id)
        return true
      } catch (err) {
        notify.error(t('Could not send the message'), err)
        if (id) void loadMessages(id).catch(() => undefined)
        return false
      }
    },

    stop: async () => {
      const id = get().activeId
      if (id) await invoke('chat:stop', { id }).catch(fail(t('Could not stop the answer')))
    },

    regenerate: async () => {
      const id = get().activeId
      if (!id) return
      try {
        await invoke('chat:regenerate', { id })
        await loadMessages(id)
      } catch (err) {
        notify.error(t('Could not regenerate the answer'), err)
      }
    },

    edit: async (messageId, text) => {
      const id = get().activeId
      if (!id) return
      try {
        await invoke('chat:edit', { id, messageId, text })
        await loadMessages(id)
      } catch (err) {
        notify.error(t('Could not edit the message'), err)
      }
    },

    update: async (id, fields) => {
      await invoke('chat:update', { id, ...fields }).catch(fail(t('Could not save the conversation')))
    },

    remove: async (id) => {
      try {
        await invoke('chat:delete', { id })
        if (get().activeId === id) set({ activeId: null })
        const { [id]: _gone, ...messages } = get().messages
        set({ messages })
      } catch (err) {
        notify.error(t('Could not delete the conversation'), err)
      }
    },

    search: async (query) => {
      set({ query })
      if (!query.trim()) {
        set({ matches: null })
        return
      }
      try {
        const matches = await invoke('chat:search', { query })
        if (get().query === query) set({ matches })
      } catch {
        set({ matches: [] })
      }
    },

    loadUsage: async (id) => {
      try {
        set({ usage: { ...get().usage, [id]: await invoke('chat:usage', { id }) } })
      } catch {
        // The header simply shows nothing.
      }
    },

    continueInProject: async () => {
      const id = get().activeId
      if (!id) return
      try {
        const info = await invoke('chat:continueInProject', { id })
        const agents = useAgents.getState()
        // The session event may arrive after the reply; select it once the panel knows it.
        agents.select(info.id)
        const layout = useLayout.getState()
        layout.setAgentPanelOpen(true)
        notify.success(t('Continued in the project'), t('The agent panel has this conversation as context.'))
      } catch (err) {
        notify.error(t('Could not continue in the project'), err)
      }
    }
  }
})
