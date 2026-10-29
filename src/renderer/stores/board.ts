import { create } from 'zustand'
import type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentDefinitionUpdate,
  MergeResult,
  Task,
  TaskChange,
  TaskFileDiff,
  TaskInput
} from '@shared/tasks'
import { invoke, on } from '@/lib/ipc'
import { notify } from './notifications'
import { useWorkspace } from './workspace'

interface Review {
  taskId: string
  changes: TaskChange[] | null
  selected: string | null
  diff: TaskFileDiff | null
  loading: boolean
}

interface BoardState {
  agents: AgentDefinition[]
  tasks: Task[]
  review: Review | null
  busy: Record<string, boolean>
  init: () => () => void
  reloadTasks: () => Promise<void>
  saveAgent: (input: AgentDefinitionInput | AgentDefinitionUpdate) => Promise<AgentDefinition | null>
  deleteAgent: (id: string) => Promise<void>
  createTask: (input: TaskInput) => Promise<Task | null>
  startTask: (id: string) => Promise<void>
  requestChanges: (id: string, comments: string) => Promise<boolean>
  merge: (id: string) => Promise<MergeResult | null>
  abandon: (id: string) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  openReview: (taskId: string) => Promise<void>
  selectFile: (path: string) => Promise<void>
  closeReview: () => void
}

export const useBoard = create<BoardState>()((set, get) => {
  /** Runs one task action with a busy flag and a toast on failure. */
  const act = async <T>(id: string, title: string, run: () => Promise<T>): Promise<T | null> => {
    set({ busy: { ...get().busy, [id]: true } })
    try {
      return await run()
    } catch (err) {
      notify.error(title, err)
      return null
    } finally {
      const { [id]: _done, ...busy } = get().busy
      set({ busy })
    }
  }

  return {
    agents: [],
    tasks: [],
    review: null,
    busy: {},

    init: () => {
      const offs = [
        on('agents:changed', (agents) => set({ agents })),
        on('tasks:changed', (tasks) => {
          set({ tasks })
          const review = get().review
          if (review && !tasks.some((t) => t.id === review.taskId && t.status !== 'done')) set({ review: null })
        }),
        // The board shows the tasks of the open repository.
        useWorkspace.subscribe((s, prev) => {
          if (s.info?.root !== prev.info?.root) void get().reloadTasks()
        })
      ]
      invoke('agents:list')
        .then((agents) => set({ agents }))
        .catch(() => undefined)
      void get().reloadTasks()
      return () => offs.forEach((off) => off())
    },

    reloadTasks: async () => {
      try {
        set({ tasks: await invoke('tasks:list') })
      } catch (err) {
        notify.error('Could not load the board', err)
      }
    },

    saveAgent: async (input) => {
      try {
        return 'id' in input ? await invoke('agents:update', input) : await invoke('agents:create', input)
      } catch (err) {
        notify.error('Could not save the agent', err)
        return null
      }
    },

    deleteAgent: async (id) => {
      await invoke('agents:delete', { id }).catch((err) => notify.error('Could not delete the agent', err))
    },

    createTask: (input) => act('new-task', 'Could not create the task', () => invoke('tasks:create', input)),

    startTask: async (id) => {
      await act(id, 'Could not start the task', () => invoke('tasks:start', { id }))
    },

    requestChanges: async (id, comments) => {
      const task = await act(id, 'Could not send the changes', () => invoke('tasks:requestChanges', { id, comments }))
      if (task) set({ review: null })
      return !!task
    },

    merge: async (id) => {
      const result = await act(id, 'Merge failed', () => invoke('tasks:merge', { id }))
      if (result?.ok) {
        notify.success('Merged', `Commit ${result.commit.slice(0, 8)}`)
        set({ review: null })
      } else if (result) notify.error('Not merged', result.reason)
      return result
    },

    abandon: async (id) => {
      const task = await act(id, 'Could not abandon the task', () => invoke('tasks:abandon', { id }))
      if (task) set({ review: null })
    },

    deleteTask: async (id) => {
      await act(id, 'Could not delete the task', () => invoke('tasks:delete', { id }))
    },

    openReview: async (taskId) => {
      set({ review: { taskId, changes: null, selected: null, diff: null, loading: true } })
      try {
        const changes = await invoke('tasks:changes', { id: taskId })
        set({ review: { taskId, changes, selected: null, diff: null, loading: false } })
        const first = changes[0]
        if (first) await get().selectFile(first.path)
      } catch (err) {
        notify.error('Could not load the changes', err)
        set({ review: null })
      }
    },

    selectFile: async (path) => {
      const review = get().review
      if (!review) return
      set({ review: { ...review, selected: path, loading: true } })
      try {
        const diff = await invoke('tasks:fileDiff', { id: review.taskId, path })
        const current = get().review
        if (current?.selected === path) set({ review: { ...current, diff, loading: false } })
      } catch (err) {
        notify.error('Could not load this file', err)
      }
    },

    closeReview: () => set({ review: null })
  }
})
