import { create } from 'zustand'
import { t, tn } from '@shared/i18n'
import type { McpImportPreview, McpServer, McpServerInput, McpServerUpdate } from '@shared/mcp'
import type { McpPreset, McpProbe } from '@shared/mcp-catalog'
import { invoke, on } from '@/lib/ipc'
import { notify } from './notifications'

interface McpState {
  servers: McpServer[]
  loaded: boolean
  init: () => () => void
  create: (input: McpServerInput) => Promise<boolean>
  update: (input: McpServerUpdate) => Promise<boolean>
  remove: (id: string) => Promise<void>
  reconnect: (id: string) => Promise<void>
  /** The import being previewed, after the user picked a file. */
  preview: McpImportPreview | null
  picking: boolean
  /** Opens the file picker, then the preview. */
  startImport: () => Promise<void>
  closeImport: () => void
  importServers: (path: string, names: string[]) => Promise<boolean>
  /** The catalog: built-in presets and the user's own. */
  presets: McpPreset[]
  loadPresets: () => Promise<void>
  installPreset: (presetId: string, values: Record<string, string>) => Promise<boolean>
  /** Starts a preset (or a server) without saving it and lists its tools. */
  test: (request: { presetId: string; values: Record<string, string> } | { server: McpServerInput }) => Promise<McpProbe | null>
  savePreset: (serverId: string, title: string, description: string) => Promise<boolean>
  deletePreset: (id: string) => Promise<void>
}

export const useMcp = create<McpState>()((set) => ({
  servers: [],
  loaded: false,
  presets: [],

  loadPresets: async () => {
    try {
      set({ presets: await invoke('mcp:presets') })
    } catch (err) {
      notify.error(t('Could not load the catalog'), err)
    }
  },

  installPreset: async (presetId, values) => {
    try {
      set({ servers: await invoke('mcp:installPreset', { presetId, values }) })
      return true
    } catch (err) {
      notify.error(t('Could not add the server'), err)
      return false
    }
  },

  test: async (request) => {
    try {
      return await invoke('mcp:test', request)
    } catch (err) {
      notify.error(t('The test could not run'), err)
      return null
    }
  },

  savePreset: async (serverId, title, description) => {
    try {
      set({ presets: [...(await invoke('mcp:presets')).filter((p) => p.builtin), ...(await invoke('mcp:savePreset', { serverId, title, description }))] })
      notify.success(t('Preset saved'), t('It is in the catalog; its secrets will be asked at install.'))
      return true
    } catch (err) {
      notify.error(t('Could not save the preset'), err)
      return false
    }
  },

  deletePreset: async (id) => {
    try {
      const own = await invoke('mcp:deletePreset', { id })
      set((s) => ({ presets: [...s.presets.filter((p) => p.builtin), ...own] }))
    } catch (err) {
      notify.error(t('Could not delete the preset'), err)
    }
  },
  preview: null,
  picking: false,

  init: () => {
    const off = on('mcp:changed', (servers) => set({ servers }))
    invoke('mcp:list')
      .then((servers) => set({ servers, loaded: true }))
      .catch((err) => {
        set({ loaded: true })
        notify.error(t('Could not load MCP servers'), err)
      })
    return off
  },

  create: async (input) => {
    try {
      set({ servers: await invoke('mcp:create', input) })
      return true
    } catch (err) {
      notify.error(t('Could not add the server'), err)
      return false
    }
  },

  update: async (input) => {
    try {
      set({ servers: await invoke('mcp:update', input) })
      return true
    } catch (err) {
      notify.error(t('Could not save the server'), err)
      return false
    }
  },

  remove: async (id) => {
    await invoke('mcp:delete', { id }).catch((err) => notify.error(t('Could not delete the server'), err))
  },

  reconnect: async (id) => {
    await invoke('mcp:reconnect', { id }).catch((err) => notify.error(t('Could not reconnect'), err))
  },

  startImport: async () => {
    set({ picking: true })
    try {
      set({ preview: await invoke('mcp:importPreview') })
    } catch (err) {
      notify.error(t('Could not read that file'), err)
    } finally {
      set({ picking: false })
    }
  },

  closeImport: () => set({ preview: null }),

  importServers: async (path, names) => {
    try {
      set({ servers: await invoke('mcp:import', { path, names }) })
      notify.success(tn('Imported {count} server', 'Imported {count} servers', names.length))
      return true
    } catch (err) {
      notify.error(t('Import failed'), err)
      return false
    }
  }
}))
