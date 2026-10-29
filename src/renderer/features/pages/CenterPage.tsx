import { Bot, Gauge } from 'lucide-react'
import type { CenterView } from '@/stores/layout'
import { EmptyState } from '@/components/EmptyState'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { AccountsPage } from '@/features/accounts/AccountsPage'
import { McpPage } from '@/features/mcp/McpPage'

const PLACEHOLDERS = {
  agents: {
    icon: Bot,
    title: 'Agents',
    description: 'Run several agents in parallel, each on its own branch and worktree, and review their diffs on a Kanban board.'
  },
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
  const page = PLACEHOLDERS[view]
  return <EmptyState icon={page.icon} title={page.title} description={page.description} />
}
