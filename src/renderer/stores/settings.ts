import { create } from 'zustand'
import { defaultSettings, withSetting, type SettingPath, type Settings, type SettingValue } from '@shared/settings'
import { invoke } from '@/lib/ipc'
import { notify } from './notifications'

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: <P extends SettingPath>(path: P, value: SettingValue<P>) => Promise<void>
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
  update: async (path, value) => {
    const previous = get().settings
    set({ settings: withSetting(previous, path, value) as Settings })
    try {
      set({ settings: await invoke('settings:set', { path, value }) })
    } catch (err) {
      set({ settings: previous })
      notify.error('Could not save setting', err)
    }
  }
}))
