import { Bot, FolderGit2, Moon, PanelBottom, PanelLeft, PanelRight, Sun } from 'lucide-react'
import { IconButton } from '@/components/IconButton'
import { useLayout } from '@/stores/layout'
import { useSettings } from '@/stores/settings'
import { useWorkspace } from '@/stores/workspace'
import { useResolvedTheme } from '@/lib/theme'

export function StatusBar() {
  const workspace = useWorkspace((s) => s.info)
  const theme = useResolvedTheme((s) => s.theme)
  const updateSetting = useSettings((s) => s.update)
  const layout = useLayout()

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t bg-chrome px-2 text-[11px] text-chrome-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1.5 truncate">
          <FolderGit2 className="size-3" />
          {workspace ? workspace.name : 'No folder open'}
        </span>
        <span className="flex items-center gap-1.5 opacity-70">
          <Bot className="size-3" />
          No active agent
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <IconButton
          icon={PanelLeft}
          label="Toggle sidebar"
          shortcut="Ctrl+B"
          side="top"
          active={layout.sidebarOpen}
          onClick={layout.toggleSidebar}
          className="size-5"
        />
        <IconButton
          icon={PanelBottom}
          label="Toggle terminal"
          shortcut="Ctrl+J"
          side="top"
          active={layout.terminalOpen}
          onClick={layout.toggleTerminal}
          className="size-5"
        />
        <IconButton
          icon={PanelRight}
          label="Toggle agent panel"
          shortcut="Ctrl+Alt+B"
          side="top"
          active={layout.agentPanelOpen}
          onClick={layout.toggleAgentPanel}
          className="size-5"
        />
        <IconButton
          icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          side="top"
          onClick={() => void updateSetting('theme', theme === 'dark' ? 'light' : 'dark')}
          className="size-5"
        />
      </div>
    </footer>
  )
}
