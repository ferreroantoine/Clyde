import { Group, Panel, useDefaultLayout } from 'react-resizable-panels'
import { t, tk } from '@shared/i18n'
import type { CenterView } from '@/stores/layout'
import { useLayout } from '@/stores/layout'
import { ActivityBar } from './ActivityBar'
import { StatusBar } from './StatusBar'
import { ResizeHandle } from './ResizeHandle'
import { usePanelSync } from './usePanelSync'
import { Sidebar } from '@/features/explorer/Sidebar'
import { EditorArea } from '@/features/editor/EditorArea'
import { TerminalPanel } from '@/features/terminal/TerminalPanel'
import { AgentPanel } from '@/features/agent-panel/AgentPanel'
import { CenterPage } from '@/features/pages/CenterPage'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const CENTER_SCOPES: Record<CenterView, string> = { editor: tk('The editor'), agents: tk('The agents board'), supervision: tk('Supervision'), settings: tk('Settings') }

const storage = typeof window !== 'undefined' ? window.localStorage : undefined

export function Shell() {
  const center = useLayout((s) => s.center)
  const sidebar = usePanelSync(useLayout((s) => s.sidebarOpen), useLayout((s) => s.setSidebarOpen))
  const agent = usePanelSync(useLayout((s) => s.agentPanelOpen), useLayout((s) => s.setAgentPanelOpen))
  const terminal = usePanelSync(useLayout((s) => s.terminalOpen), useLayout((s) => s.setTerminalOpen))

  const outer = useDefaultLayout({ id: 'atelier.outer', ...(storage ? { storage } : {}) })
  const middle = useDefaultLayout({ id: 'atelier.middle', ...(storage ? { storage } : {}) })

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <Group
          orientation="horizontal"
          className="min-w-0 flex-1"
          defaultLayout={outer.defaultLayout}
          onLayoutChanged={outer.onLayoutChanged}
        >
          <Panel
            id="sidebar"
            panelRef={sidebar.panelRef}
            onResize={sidebar.onResize}
            collapsible
            collapsedSize={0}
            defaultSize={260}
            minSize={180}
            maxSize="45"
            className="bg-chrome"
          >
            <Sidebar />
          </Panel>
          <ResizeHandle orientation="horizontal" />
          <Panel id="center" minSize={320}>
            <Group
              orientation="vertical"
              defaultLayout={middle.defaultLayout}
              onLayoutChanged={middle.onLayoutChanged}
            >
              <Panel id="main" minSize={120}>
                <div className="relative h-full">
                  <div className={cn('h-full', center !== 'editor' && 'invisible')}>
                    <EditorArea />
                  </div>
                  {center !== 'editor' && (
                    <div className="absolute inset-0 bg-background">
                      <ErrorBoundary key={center} scope={t(CENTER_SCOPES[center])}>
                        <CenterPage view={center} />
                      </ErrorBoundary>
                    </div>
                  )}
                </div>
              </Panel>
              <ResizeHandle orientation="vertical" />
              <Panel
                id="terminal"
                panelRef={terminal.panelRef}
                onResize={terminal.onResize}
                collapsible
                collapsedSize={0}
                defaultSize="30"
                minSize={110}
                className="bg-terminal"
              >
                <TerminalPanel />
              </Panel>
            </Group>
          </Panel>
          <ResizeHandle orientation="horizontal" />
          <Panel
            id="agent"
            panelRef={agent.panelRef}
            onResize={agent.onResize}
            collapsible
            collapsedSize={0}
            defaultSize={360}
            minSize={280}
            maxSize="50"
            className="bg-chrome"
          >
            <ErrorBoundary scope={t('The agent panel')}>
              <AgentPanel />
            </ErrorBoundary>
          </Panel>
        </Group>
      </div>
      <StatusBar />
    </div>
  )
}
