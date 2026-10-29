import { create } from 'zustand'
import { defaultSettings, type SettingKey, type Settings } from '@shared/settings'
import { invoke } from '@/lib/ipc'
import { notify } from './notifications'

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<void>
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: defaultSettings,
  loaded: false,
  load: async () => {
    try {
      set({ settings: await invoke('settings:getAll'), loaded: true })
    } catch (err) {
      set({ loaded: true })
      notify.error('Could not load settings', err)
    }
  },
  update: async (key, value) => {
    const previous = get().settings
    set({ settings: { ...previous, [key]: value } })
    try {
      set({ settings: await invoke('settings:set', { key, value }) })
    } catch (err) {
      set({ settings: previous })
      notify.error('Could not save setting', err)
    }
  }
}))
