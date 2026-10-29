import { create } from 'zustand'
import type { ConnectionResult, Profile, ProfileCreate, ProfileUpdate } from '@shared/profiles'
import { invoke, on } from '@/lib/ipc'
import { notify } from './notifications'

interface ProfilesState {
  profiles: Profile[]
  loaded: boolean
  /** Last connection test per profile; `testing` while one runs. */
  tests: Record<string, ConnectionResult | 'testing'>
  init: () => () => void
  create: (input: ProfileCreate) => Promise<Profile | null>
  update: (input: ProfileUpdate) => Promise<Profile | null>
  remove: (id: string) => Promise<void>
  test: (id: string) => Promise<ConnectionResult | null>
}

export const useProfiles = create<ProfilesState>()((set, get) => ({
  profiles: [],
  loaded: false,
  tests: {},

  init: () => {
    const off = on('profiles:changed', (profiles) => set({ profiles }))
    invoke('profiles:list')
      .then((profiles) => set({ profiles, loaded: true }))
      .catch((err) => {
        set({ loaded: true })
        notify.error('Could not load accounts', err)
      })
    return off
  },

  create: async (input) => {
    try {
      return await invoke('profiles:create', input)
    } catch (err) {
      notify.error('Could not add the account', err)
      return null
    }
  },

  update: async (input) => {
    try {
      return await invoke('profiles:update', input)
    } catch (err) {
      notify.error('Could not save the account', err)
      return null
    }
  },

  remove: async (id) => {
    try {
      await invoke('profiles:delete', { id })
      const { [id]: _removed, ...tests } = get().tests
      set({ tests })
    } catch (err) {
      notify.error('Could not delete the account', err)
    }
  },

  test: async (id) => {
    set({ tests: { ...get().tests, [id]: 'testing' } })
    try {
      const result = await invoke('profiles:test', { id })
      set({ tests: { ...get().tests, [id]: result } })
      return result
    } catch (err) {
      const { [id]: _pending, ...tests } = get().tests
      set({ tests })
      notify.error('Connection test failed', err)
      return null
    }
  }
}))

export function profileById(profiles: Profile[], id: string | undefined): Profile | undefined {
  return id ? profiles.find((p) => p.id === id) : undefined
}
