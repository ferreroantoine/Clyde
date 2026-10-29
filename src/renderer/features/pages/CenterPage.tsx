import type { CenterView } from '@/stores/layout'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { AccountsPage } from '@/features/accounts/AccountsPage'
import { McpPage } from '@/features/mcp/McpPage'
import { AgentsPage } from '@/features/agents/AgentsPage'
import { SupervisionPage } from '@/features/supervision/SupervisionPage'

export function CenterPage({ view }: { view: Exclude<CenterView, 'editor'> }) {
  switch (view) {
    case 'settings':
      return <SettingsPage />
    case 'accounts':
      return <AccountsPage />
    case 'mcp':
      return <McpPage />
    case 'agents':
      return <AgentsPage />
    case 'supervision':
      return <SupervisionPage />
  }
}
