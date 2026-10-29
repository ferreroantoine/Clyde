import { create } from 'zustand'

export type NoticeLevel = 'info' | 'success' | 'error'

export interface Notice {
  id: number
  level: NoticeLevel
  title: string
  detail?: string
  /** Stays until dismissed, for messages the user must not miss. */
  persistent?: boolean
}

interface NotificationState {
  notices: Notice[]
  push: (notice: Omit<Notice, 'id'>) => void
  dismiss: (id: number) => void
}

let nextId = 1
const AUTO_DISMISS_MS = 6000

export const useNotifications = create<NotificationState>()((set, get) => ({
  notices: [],
  push: (notice) => {
    const id = nextId++
    set({ notices: [...get().notices, { ...notice, id }].slice(-5) })
    if (!notice.persistent) {
      setTimeout(() => get().dismiss(id), notice.level === 'error' ? AUTO_DISMISS_MS * 2 : AUTO_DISMISS_MS)
    }
  },
  dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) })
}))

function detailOf(err: unknown): string | undefined {
  if (err instanceof Error) return err.message
  if (err === undefined) return undefined
  return String(err)
}

/** Imperative helpers so stores and services can surface errors without React. */
export const notify = {
  info: (title: string, detail?: string) =>
    useNotifications.getState().push({ level: 'info', title, ...(detail ? { detail } : {}) }),
  success: (title: string, detail?: string) =>
    useNotifications.getState().push({ level: 'success', title, ...(detail ? { detail } : {}) }),
  error: (title: string, err?: unknown) => {
    const detail = detailOf(err)
    useNotifications.getState().push({ level: 'error', title, ...(detail ? { detail } : {}) })
  }
}
