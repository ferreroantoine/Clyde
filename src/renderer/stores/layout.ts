import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CenterView = 'editor' | 'agents' | 'supervision' | 'settings'
const CENTER_VIEWS: CenterView[] = ['editor', 'agents', 'supervision', 'settings']

export const SETTINGS_SECTIONS = [
  'general',
  'appearance',
  'accounts',
  'agents',
  'usage',
  'editor',
  'terminal',
  'voice',
  'mcp',
  'memory',
  'shortcuts',
  'notifications',
  'data',
  'about'
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]
export type SidebarTab = 'files' | 'search'
/** A dialog another part of the UI (the command palette) asked a page to open. */
export type Intent = 'new-account' | 'new-mcp' | 'new-task' | 'new-agent'

const INTENT_VIEW: Record<Intent, { view: CenterView; section?: SettingsSection }> = {
  'new-account': { view: 'settings', section: 'accounts' },
  'new-mcp': { view: 'settings', section: 'mcp' },
  'new-task': { view: 'agents' },
  'new-agent': { view: 'agents' }
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
  settingsSection: SettingsSection
  /** Opens Settings, on a section when given. */
  showSettings: (section?: SettingsSection) => void
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
      settingsSection: 'general',
      showSettings: (section) => set((s) => ({ center: 'settings', settingsSection: section ?? s.settingsSection })),
      showSidebarTab: (tab) => set({ sidebarTab: tab, sidebarOpen: true, center: 'editor' }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setAgentPanelOpen: (open) => set({ agentPanelOpen: open }),
      setTerminalOpen: (open) => set({ terminalOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleAgentPanel: () => set((s) => ({ agentPanelOpen: !s.agentPanelOpen })),
      toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
      intent: null,
      request: (intent) => {
        const target = INTENT_VIEW[intent]
        set((s) => ({ intent, center: target.view, settingsSection: target.section ?? s.settingsSection }))
      },
      clearIntent: () => set({ intent: null })
    }),
    {
      name: 'atelier.layout',
      // Views that no longer exist (Accounts and MCP moved into Settings) fall back to the editor.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LayoutState>
        const center = p.center && CENTER_VIEWS.includes(p.center) ? p.center : current.center
        const settingsSection = p.settingsSection && SETTINGS_SECTIONS.includes(p.settingsSection) ? p.settingsSection : current.settingsSection
        return { ...current, ...p, center, settingsSection }
      },
      partialize: ({ center, sidebarTab, sidebarOpen, agentPanelOpen, terminalOpen, settingsSection }) => ({
        center,
        settingsSection,
        sidebarTab,
        sidebarOpen,
        agentPanelOpen,
        terminalOpen
      })
    }
  )
)
