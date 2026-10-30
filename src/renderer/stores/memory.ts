import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { MemoryScope, MemoryState } from '@shared/memory'
import { invoke, on } from '@/lib/ipc'
import { notify } from './notifications'

interface MemoryStore {
  state: MemoryState | null
  /** Scopes being consolidated by the internal model. */
  busy: MemoryScope[]
  init: () => () => void
  load: () => Promise<void>
  saveCore: (scope: MemoryScope, text: string) => Promise<boolean>
  saveDoc: (scope: MemoryScope, name: string | null, title: string, content: string) => Promise<boolean>
  deleteDoc: (scope: MemoryScope, name: string) => Promise<void>
  consolidate: (scope: MemoryScope) => Promise<void>
  accept: (id: string, text?: string) => Promise<void>
  reject: (id: string) => Promise<void>
  open: (scope: MemoryScope) => Promise<void>
}

/** After a save that masked a credential, say so: the file never holds it. */
function afterSave(state: MemoryState): void {
  if (state.redacted) notify.warning(t('A secret was masked'), t('Memory files are read by every agent and may be committed; keep credentials in the accounts instead.'))
}

export const useMemory = create<MemoryStore>((set, get) => ({
  state: null,
  busy: [],
  init: () => on('memory:changed', (state) => set({ state })),
  load: async () => {
    try {
      set({ state: await invoke('memory:state') })
    } catch (err) {
      notify.error(t('Could not read the memory'), err)
    }
  },
  saveCore: async (scope, text) => {
    try {
      const state = await invoke('memory:saveCore', { scope, text })
      set({ state })
      afterSave(state)
      return true
    } catch (err) {
      notify.error(t('Could not save the memory'), err)
      return false
    }
  },
  saveDoc: async (scope, name, title, content) => {
    try {
      const state = await invoke('memory:saveDoc', { scope, name, title, content })
      set({ state })
      afterSave(state)
      return true
    } catch (err) {
      notify.error(t('Could not save the note'), err)
      return false
    }
  },
  deleteDoc: async (scope, name) => {
    try {
      set({ state: await invoke('memory:deleteDoc', { scope, name }) })
    } catch (err) {
      notify.error(t('Could not delete the note'), err)
    }
  },
  consolidate: async (scope) => {
    set({ busy: [...get().busy, scope] })
    try {
      const made = await invoke('memory:consolidate', { scope })
      if (!made) notify.info(t('Nothing to consolidate'), t('The memory is already tidy.'))
    } catch (err) {
      notify.error(t('Could not consolidate the memory'), err)
    } finally {
      set({ busy: get().busy.filter((s) => s !== scope) })
    }
  },
  accept: async (id, text) => {
    try {
      const state = await invoke('memory:accept', { id, ...(text !== undefined ? { text } : {}) })
      set({ state })
      afterSave(state)
    } catch (err) {
      notify.error(t('Could not apply the proposal'), err)
    }
  },
  reject: async (id) => {
    try {
      set({ state: await invoke('memory:reject', { id }) })
    } catch (err) {
      notify.error(t('Could not dismiss the proposal'), err)
    }
  },
  open: async (scope) => {
    await invoke('memory:open', { scope }).catch((err: unknown) => notify.error(t('Could not open the folder'), err))
  }
}))
