import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { Todo, TodoStatus } from '@shared/todos'
import { invoke, on } from '@/lib/ipc'
import type { TodoFilter } from '@/lib/todo-view'
import { notify } from './notifications'
import { useWorkspace } from './workspace'

interface TodosState {
  todos: Todo[]
  loaded: boolean
  filter: TodoFilter
  hideDone: boolean
  /** Text the add field opens with (from the explorer), bumped to focus it. */
  addDraft: { id: number; text: string } | null
  init: () => () => void
  reload: () => Promise<void>
  setFilter: (filter: TodoFilter) => void
  setHideDone: (hide: boolean) => void
  create: (text: string, status?: TodoStatus) => Promise<Todo | null>
  /** Drag and drop: shown at once, then saved. */
  move: (id: string, status: TodoStatus, beforeId: string | null) => Promise<void>
  edit: (id: string, text: string) => Promise<void>
  remove: (id: string) => Promise<void>
  assign: (id: string, sessionId: string) => Promise<boolean>
  /** Opens the add field with this text. */
  draft: (text: string) => void
}

export const useTodos = create<TodosState>()((set, get) => ({
  todos: [],
  loaded: false,
  filter: { kind: 'all' },
  hideDone: false,
  addDraft: null,

  init: () => {
    const offs = [
      on('todos:changed', () => void get().reload()),
      // Each project has its own tasks.
      useWorkspace.subscribe((s, prev) => {
        if (s.info?.root !== prev.info?.root) {
          set({ filter: { kind: 'all' } })
          void get().reload()
        }
      })
    ]
    void get().reload()
    return () => offs.forEach((off) => off())
  },

  reload: async () => {
    try {
      set({ todos: await invoke('todos:list'), loaded: true })
    } catch (err) {
      set({ loaded: true })
      notify.error(t('Could not load the tasks'), err)
    }
  },

  setFilter: (filter) => set({ filter }),
  setHideDone: (hideDone) => set({ hideDone }),

  create: async (text, status = 'todo') => {
    try {
      const todo = await invoke('todos:create', { text, status })
      set({ todos: [...get().todos.filter((x) => x.id !== todo.id), todo] })
      return todo
    } catch (err) {
      notify.error(t('Could not add the task'), err)
      return null
    }
  },

  move: async (id, status, beforeId) => {
    const before = get().todos
    const moving = before.find((x) => x.id === id)
    if (!moving || id === beforeId) return
    const rest = before.filter((x) => x.id !== id)
    const at = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1
    const moved = { ...moving, status }
    set({ todos: at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)] })
    try {
      await invoke('todos:update', { id, status, beforeId })
    } catch (err) {
      set({ todos: before })
      notify.error(t('Could not move the task'), err)
    }
  },

  edit: async (id, text) => {
    try {
      const todo = await invoke('todos:update', { id, text })
      set({ todos: get().todos.map((x) => (x.id === id ? todo : x)) })
    } catch (err) {
      notify.error(t('Could not save the task'), err)
    }
  },

  remove: async (id) => {
    const before = get().todos
    set({ todos: before.filter((x) => x.id !== id) })
    await invoke('todos:delete', { id }).catch((err) => {
      set({ todos: before })
      notify.error(t('Could not delete the task'), err)
    })
  },

  assign: async (id, sessionId) => {
    try {
      const todo = await invoke('todos:assign', { id, sessionId })
      set({ todos: get().todos.map((x) => (x.id === id ? todo : x)) })
      return true
    } catch (err) {
      notify.error(t('Could not hand the task over'), err)
      return false
    }
  },

  draft: (text) => set({ addDraft: { id: (get().addDraft?.id ?? 0) + 1, text } })
}))
