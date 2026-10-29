import { create } from 'zustand'
import { invoke, on } from '@/lib/ipc'
import { terminals } from '@/lib/terminal/registry'
import { notify } from './notifications'

export interface TerminalTab {
  id: string
  title: string
  cwd: string
  /** Agent terminals mirror what an agent runs and accept no input. */
  kind: 'shell' | 'agent'
  exitCode: number | null
}

interface TerminalsState {
  tabs: TerminalTab[]
  active: string | null
  creating: boolean
  init: () => () => void
  create: () => Promise<void>
  close: (id: string) => Promise<void>
  activate: (id: string) => void
}

export const useTerminals = create<TerminalsState>()((set, get) => ({
  tabs: [],
  active: null,
  creating: false,

  init: () => {
    const offs = [
      on('pty:data', ({ id, data }) => terminals.write(id, data)),
      on('pty:exit', ({ id, exitCode }) => {
        terminals.write(id, `\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`)
        set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, exitCode } : t)) })
      })
    ]
    return () => offs.forEach((off) => off())
  },

  create: async () => {
    if (get().creating) return
    set({ creating: true })
    try {
      const info = await invoke('pty:create', { cols: 100, rows: 24 })
      terminals.create(
        info.id,
        { readOnly: false, windowsBuild: info.windowsBuild },
        {
          onInput: (data) => void invoke('pty:write', { id: info.id, data }).catch(() => undefined),
          onResize: (cols, rows) => void invoke('pty:resize', { id: info.id, cols, rows }).catch(() => undefined)
        }
      )
      const tab: TerminalTab = { id: info.id, title: info.title, cwd: info.cwd, kind: 'shell', exitCode: null }
      set({ tabs: [...get().tabs, tab], active: info.id })
    } catch (err) {
      notify.error('Could not start a terminal', err)
    } finally {
      set({ creating: false })
    }
  },

  close: async (id) => {
    const { tabs, active } = get()
    const index = tabs.findIndex((t) => t.id === id)
    const tab = tabs[index]
    if (!tab) return
    if (tab.exitCode === null) await invoke('pty:kill', { id }).catch(() => undefined)
    terminals.dispose(id)
    const rest = tabs.filter((t) => t.id !== id)
    set({ tabs: rest, active: active === id ? ((rest[index] ?? rest[index - 1])?.id ?? null) : active })
  },

  activate: (id) => set({ active: id })
}))
