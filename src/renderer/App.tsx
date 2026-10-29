import { useEffect, useMemo } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Shell } from '@/layout/Shell'
import { Toaster } from '@/layout/Toaster'
import { useApplyTheme } from '@/lib/theme'
import { useShortcuts, type Shortcut } from '@/lib/shortcuts'
import { useLayout } from '@/stores/layout'
import { useSettings } from '@/stores/settings'

export function App() {
  const theme = useSettings((s) => s.settings.theme)
  const loadSettings = useSettings((s) => s.load)
  useApplyTheme(theme)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const shortcuts = useMemo<Shortcut[]>(() => {
    const layout = useLayout.getState
    return [
      { combo: 'ctrl+b', run: () => layout().toggleSidebar() },
      { combo: 'ctrl+j', run: () => layout().toggleTerminal() },
      { combo: 'ctrl+`', run: () => layout().toggleTerminal() },
      { combo: 'ctrl+alt+b', run: () => layout().toggleAgentPanel() },
      { combo: 'ctrl+shift+e', run: () => layout().showSidebarTab('files') },
      { combo: 'ctrl+shift+f', run: () => layout().showSidebarTab('search') },
      { combo: 'ctrl+,', run: () => layout().showCenter('settings') }
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
