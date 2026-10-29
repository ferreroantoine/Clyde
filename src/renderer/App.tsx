import { useEffect, useMemo } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Shell } from '@/layout/Shell'
import { Toaster } from '@/layout/Toaster'
import { useApplyTheme, useResolvedTheme } from '@/lib/theme'
import { terminals } from '@/lib/terminal/registry'
import { useTerminals } from '@/stores/terminals'
import { useShortcuts, type Shortcut } from '@/lib/shortcuts'
import { useLayout } from '@/stores/layout'
import { useSettings } from '@/stores/settings'
import { useWorkspace } from '@/stores/workspace'
import { useEditor } from '@/stores/editor'
import { useProfiles } from '@/stores/profiles'
import { useAgents } from '@/stores/agents'
import { useMcp } from '@/stores/mcp'

export function App() {
  const theme = useSettings((s) => s.settings.theme)
  useApplyTheme(theme)

  useEffect(() => {
    void useSettings.getState().load()
    let off: (() => void) | undefined
    let disposed = false
    void useWorkspace
      .getState()
      .init()
      .then((unsubscribe) => {
        if (disposed) unsubscribe()
        else off = unsubscribe
      })
    const offTerminals = useTerminals.getState().init()
    const offProfiles = useProfiles.getState().init()
    const offAgents = useAgents.getState().init()
    const offMcp = useMcp.getState().init()
    return () => {
      offMcp()
      offAgents()
      disposed = true
      off?.()
      offTerminals()
      offProfiles()
    }
  }, [])

  const resolvedTheme = useResolvedTheme((s) => s.theme)
  const terminalFontSize = useSettings((s) => s.settings.terminalFontSize)
  useEffect(() => terminals.setTheme(resolvedTheme), [resolvedTheme])
  useEffect(() => terminals.setFontSize(terminalFontSize), [terminalFontSize])

  const shortcuts = useMemo<Shortcut[]>(() => {
    const layout = useLayout.getState
    return [
      { combo: 'ctrl+b', run: () => layout().toggleSidebar() },
      { combo: 'ctrl+j', run: () => layout().toggleTerminal() },
      { combo: 'ctrl+`', run: () => layout().toggleTerminal() },
      { combo: 'ctrl+alt+b', run: () => layout().toggleAgentPanel() },
      { combo: 'ctrl+shift+e', run: () => layout().showSidebarTab('files') },
      { combo: 'ctrl+shift+f', run: () => layout().showSidebarTab('search') },
      { combo: 'ctrl+,', run: () => layout().showCenter('settings') },
      { combo: 'ctrl+s', run: () => void useEditor.getState().save() },
      { combo: 'ctrl+o', run: () => void useWorkspace.getState().pick() }
    ]
  }, [])
  useShortcuts(shortcuts)

  return (
    <TooltipProvider delayDuration={400}>
      <Shell />
      <Toaster />
    </TooltipProvider>
  )
}
