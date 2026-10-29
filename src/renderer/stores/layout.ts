import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CenterView = 'editor' | 'agents' | 'accounts' | 'mcp' | 'supervision' | 'settings'
export type SidebarTab = 'files' | 'search'

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
      toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen }))
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
