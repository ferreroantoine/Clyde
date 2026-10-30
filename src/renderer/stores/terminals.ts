import { create } from 'zustand'
import { t } from '@shared/i18n'
import { invoke, on } from '@/lib/ipc'
import { terminals } from '@/lib/terminal/registry'
import { notify } from './notifications'
import { useLayout } from './layout'

export interface TerminalTab {
  id: string
  title: string
  cwd: string
  /** Agent terminals mirror what an agent runs and accept no input. */
  kind: 'shell' | 'agent'
  exitCode: number | null
  /** Set on the first keystroke or paste. */
  used: boolean
}

interface TerminalsState {
  tabs: TerminalTab[]
  active: string | null
  creating: boolean
  init: () => () => void
  create: () => Promise<void>
  close: (id: string) => Promise<void>
  activate: (id: string) => void
  workspaceChanged: (root: string) => Promise<void>
  /** Writes to an agent's read-only terminal, creating its tab on first use. */
  agentWrite: (sessionId: string, title: string, cwd: string, data: string) => void
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
          onResize: (cols, rows) => void invoke('pty:resize', { id: info.id, cols, rows }).catch(() => undefined),
          onFirstUse: () => set({ tabs: get().tabs.map((t) => (t.id === info.id ? { ...t, used: true } : t)) })
        }
      )
      const tab: TerminalTab = { id: info.id, title: info.title, cwd: info.cwd, kind: 'shell', exitCode: null, used: false }
      set({ tabs: [...get().tabs, tab], active: info.id })
    } catch (err) {
      notify.error(t('Could not start a terminal'), err)
    } finally {
      set({ creating: false })
    }
  },

  close: async (id) => {
    const { tabs, active } = get()
    const index = tabs.findIndex((t) => t.id === id)
    const tab = tabs[index]
    if (!tab) return
    if (tab.kind === 'shell' && tab.exitCode === null) await invoke('pty:kill', { id }).catch(() => undefined)
    terminals.dispose(id)
    const rest = tabs.filter((t) => t.id !== id)
    set({ tabs: rest, active: active === id ? ((rest[index] ?? rest[index - 1])?.id ?? null) : active })
  },

  activate: (id) => set({ active: id }),

  agentWrite: (sessionId, title, cwd, data) => {
    const id = `agent-${sessionId}`
    if (!get().tabs.some((t) => t.id === id)) {
      terminals.create(id, { readOnly: true, windowsBuild: null }, { onInput: () => undefined, onResize: () => undefined })
      const tab: TerminalTab = { id, title, cwd, kind: 'agent', exitCode: null, used: true }
      set({ tabs: [...get().tabs, tab] })
    }
    terminals.write(id, data)
  },

  /**
   * Shells nobody has typed in yet are replaced by one in the new workspace, so the terminal
   * started before any folder was open does not stay in the home directory. Used ones are kept.
   */
  workspaceChanged: async (root) => {
    const { tabs } = get()
    if (tabs.length === 0) return // the panel starts one in the workspace when it opens
    const stale = tabs.filter((t) => t.kind === 'shell' && !t.used && t.cwd !== root)
    for (const t of stale) await get().close(t.id)
    const inRoot = get().tabs.find((t) => t.kind === 'shell' && t.cwd === root && t.exitCode === null)
    if (inRoot) set({ active: inRoot.id })
    else if (useLayout.getState().terminalOpen) await get().create()
  }
}))
