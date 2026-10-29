import { create } from 'zustand'
import { t, tn } from '@shared/i18n'
import type { McpImportPreview, McpServer, McpServerInput, McpServerUpdate } from '@shared/mcp'
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
}

export const useMcp = create<McpState>()((set) => ({
  servers: [],
  loaded: false,
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
