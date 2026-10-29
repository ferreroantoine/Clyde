import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CenterView = 'editor' | 'agents' | 'accounts' | 'mcp' | 'supervision' | 'settings'
export type SidebarTab = 'files' | 'search'
/** A dialog another part of the UI (the command palette) asked a page to open. */
export type Intent = 'new-account' | 'new-mcp' | 'new-task' | 'new-agent'

const INTENT_VIEW: Record<Intent, CenterView> = {
  'new-account': 'accounts',
  'new-mcp': 'mcp',
  'new-task': 'agents',
  'new-agent': 'agents'
}

interface LayoutState {
  center: CenterView
  sidebarTab: SidebarTab
  sidebarOpen: boolean
  agentPanelOpen: boolean
  terminalOpen: boolean
  /** Explorer behaves like VS Code: clicking it again while active hides the sidebar. */
  activateExplorer: () => void
  showCenter: (view: CenterView) => void
  showSidebarTab: (tab: SidebarTab) => void
  setSidebarOpen: (open: boolean) => void
  setAgentPanelOpen: (open: boolean) => void
  setTerminalOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleAgentPanel: () => void
  toggleTerminal: () => void
  intent: Intent | null
  /** Shows the page that owns the intent; the page opens its dialog while the intent is set. */
  request: (intent: Intent) => void
  clearIntent: () => void
}

export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => ({
      center: 'editor',
      sidebarTab: 'files',
      sidebarOpen: true,
      agentPanelOpen: true,
      terminalOpen: true,
      activateExplorer: () => {
        const { center, sidebarOpen } = get()
        if (center === 'editor') set({ sidebarOpen: !sidebarOpen })
        else set({ center: 'editor', sidebarOpen: true })
      },
      showCenter: (view) => set({ center: view }),
      showSidebarTab: (tab) => set({ sidebarTab: tab, sidebarOpen: true, center: 'editor' }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setAgentPanelOpen: (open) => set({ agentPanelOpen: open }),
      setTerminalOpen: (open) => set({ terminalOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleAgentPanel: () => set((s) => ({ agentPanelOpen: !s.agentPanelOpen })),
      toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
      intent: null,
      request: (intent) => set({ intent, center: INTENT_VIEW[intent] }),
      clearIntent: () => set({ intent: null })
    }),
    {
      name: 'atelier.layout',
      partialize: ({ center, sidebarTab, sidebarOpen, agentPanelOpen, terminalOpen }) => ({
        center,
        sidebarTab,
        sidebarOpen,
        agentPanelOpen,
        terminalOpen
      })
    }
  )
)
