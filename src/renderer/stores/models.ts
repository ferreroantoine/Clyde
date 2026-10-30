import { create } from 'zustand'
import type { ModelOption } from '@shared/profiles'
import { invoke } from '@/lib/ipc'

interface ModelList {
  models: ModelOption[]
  loading: boolean
  error: string | null
}

interface ModelsState {
  lists: Record<string, ModelList>
  /** Lists an account's models once (main keeps them a few minutes); `refresh` asks again. */
  load: (profileId: string, refresh?: boolean) => Promise<void>
}

export const useModels = create<ModelsState>()((set, get) => ({
  lists: {},
  load: async (profileId, refresh = false) => {
    const current = get().lists[profileId]
    if (current?.loading || (current && !refresh && !current.error)) return
    set({ lists: { ...get().lists, [profileId]: { models: current?.models ?? [], loading: true, error: null } } })
    try {
      const models = await invoke('profiles:models', { id: profileId, ...(refresh ? { refresh } : {}) })
      set({ lists: { ...get().lists, [profileId]: { models, loading: false, error: null } } })
    } catch (err) {
      set({ lists: { ...get().lists, [profileId]: { models: current?.models ?? [], loading: false, error: (err as Error).message } } })
    }
  }
}))
