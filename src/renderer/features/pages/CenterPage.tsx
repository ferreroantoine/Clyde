import { Gauge } from 'lucide-react'
import type { CenterView } from '@/stores/layout'
import { EmptyState } from '@/components/EmptyState'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { AccountsPage } from '@/features/accounts/AccountsPage'
import { McpPage } from '@/features/mcp/McpPage'
import { AgentsPage } from '@/features/agents/AgentsPage'

const PLACEHOLDERS = {
  supervision: {
    icon: Gauge,
    title: 'Supervision',
    description: 'Active sessions, tokens, estimated cost and usage limits for every account.'
  }
} as const

export function CenterPage({ view }: { view: Exclude<CenterView, 'editor'> }) {
  if (view === 'settings') return <SettingsPage />
  if (view === 'accounts') return <AccountsPage />
  if (view === 'mcp') return <McpPage />
  if (view === 'agents') return <AgentsPage />
  const page = PLACEHOLDERS[view]
  return <EmptyState icon={page.icon} title={page.title} description={page.description} />
}
