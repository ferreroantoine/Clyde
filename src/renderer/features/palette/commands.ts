import { PROFILE_KIND_LABELS } from '@shared/profiles'
import { useAgents, ENDED_STATUSES } from '@/stores/agents'
import { useBoard } from '@/stores/board'
import { useEditor } from '@/stores/editor'
import { useLayout } from '@/stores/layout'
import { useMcp } from '@/stores/mcp'
import { usePalette } from '@/stores/palette'
import { useProfiles, profileById } from '@/stores/profiles'
import { useSettings } from '@/stores/settings'
import { useTerminals } from '@/stores/terminals'
import { useWorkspace } from '@/stores/workspace'

export interface Command {
  id: string
  title: string
  group: 'Go to' | 'View' | 'Agents' | 'Create' | 'Workspace' | 'Sessions'
  shortcut?: string
  run: () => void
}

/** Every action the palette offers, built from the current state each time it opens. */
export function buildCommands(): Command[] {
  const layout = useLayout.getState()
  const workspace = useWorkspace.getState().info
  const agents = useAgents.getState()
  const profiles = useProfiles.getState().profiles
  const settings = useSettings.getState()
  const active = agents.activeId ? agents.sessions[agents.activeId] : undefined
  const showAgentPanel = () => layout.setAgentPanelOpen(true)

  const commands: Command[] = [
    { id: 'go.files', title: 'Go to Explorer', group: 'Go to', shortcut: 'Ctrl+Shift+E', run: () => layout.showSidebarTab('files') },
    { id: 'go.search', title: 'Search in files', group: 'Go to', shortcut: 'Ctrl+Shift+F', run: () => layout.showSidebarTab('search') },
    { id: 'go.file', title: 'Go to file…', group: 'Go to', shortcut: 'Ctrl+P', run: () => setTimeout(() => usePalette.getState().show('files')) },
    { id: 'go.board', title: 'Go to Agents board', group: 'Go to', run: () => layout.showCenter('agents') },
    { id: 'go.accounts', title: 'Go to Accounts', group: 'Go to', run: () => layout.showCenter('accounts') },
    { id: 'go.mcp', title: 'Go to MCP servers', group: 'Go to', run: () => layout.showCenter('mcp') },
    { id: 'go.supervision', title: 'Go to Supervision', group: 'Go to', run: () => layout.showCenter('supervision') },
    { id: 'go.settings', title: 'Open Settings', group: 'Go to', shortcut: 'Ctrl+,', run: () => layout.showCenter('settings') },

    { id: 'view.sidebar', title: 'Toggle sidebar', group: 'View', shortcut: 'Ctrl+B', run: layout.toggleSidebar },
    { id: 'view.terminal', title: 'Toggle terminal', group: 'View', shortcut: 'Ctrl+J', run: layout.toggleTerminal },
    { id: 'view.agent', title: 'Toggle agent panel', group: 'View', shortcut: 'Ctrl+Alt+B', run: layout.toggleAgentPanel },
    ...(['light', 'dark', 'system'] as const)
      .filter((t) => t !== settings.settings.theme)
      .map((t): Command => ({
        id: `view.theme.${t}`,
        title: `Use the ${t === 'system' ? 'system' : t} theme`,
        group: 'View',
        run: () => void settings.update('theme', t)
      })),

    { id: 'ws.open', title: 'Open folder…', group: 'Workspace', shortcut: 'Ctrl+O', run: () => void useWorkspace.getState().pick() },
    { id: 'ws.terminal', title: 'New terminal', group: 'Workspace', run: () => {
      layout.setTerminalOpen(true)
      void useTerminals.getState().create()
    } },
    ...(useEditor.getState().active
      ? [{ id: 'ws.save', title: 'Save file', group: 'Workspace' as const, shortcut: 'Ctrl+S', run: () => void useEditor.getState().save() }]
      : []),

    { id: 'new.session', title: 'New agent session', group: 'Create', run: () => {
      agents.select(null)
      showAgentPanel()
    } },
    { id: 'new.task', title: 'New task…', group: 'Create', run: () => layout.request('new-task') },
    { id: 'new.agent', title: 'New saved agent…', group: 'Create', run: () => layout.request('new-agent') },
    { id: 'new.account', title: 'Add account…', group: 'Create', run: () => layout.request('new-account') },
    { id: 'new.mcp', title: 'Add MCP server…', group: 'Create', run: () => layout.request('new-mcp') },
    { id: 'new.import', title: 'Import claude_desktop_config.json…', group: 'Create', run: () => {
      layout.showCenter('mcp')
      void useMcp.getState().startImport()
    } }
  ]

  if (active && !ENDED_STATUSES.has(active.info.status)) {
    commands.push(
      { id: 'agent.interrupt', title: 'Interrupt the active agent', group: 'Agents', run: () => void agents.interrupt() },
      { id: 'agent.stop', title: 'Stop the active agent session', group: 'Agents', run: () => void agents.stop() }
    )
  }
  for (const id of agents.order) {
    const view = agents.sessions[id]
    if (!view || id === agents.activeId) continue
    const profile = profileById(profiles, view.info.profileId)
    commands.push({
      id: `session.${id}`,
      title: `Switch to ${profile?.name ?? 'agent'} · ${view.info.model || 'default model'}${ENDED_STATUSES.has(view.info.status) ? ' (ended)' : ''}`,
      group: 'Sessions',
      run: () => {
        agents.select(id)
        showAgentPanel()
      }
    })
  }
  for (const agent of useBoard.getState().agents) {
    const profile = profileById(profiles, agent.profileId)
    if (!workspace || !profile?.usable) continue
    commands.push({
      id: `agent.start.${agent.id}`,
      title: `Chat with ${agent.name} (${profile.name}, ${PROFILE_KIND_LABELS[profile.kind]})`,
      group: 'Agents',
      run: () => {
        showAgentPanel()
        void agents.start({
          profileId: agent.profileId,
          model: agent.model,
          permissionLevel: agent.permissionLevel,
          systemPrompt: agent.systemPrompt,
          mcpTools: agent.mcpTools,
          agentId: agent.id
        })
      }
    })
  }
  return commands
}
