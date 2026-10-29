import { Bot, Gauge, KeyRound, Plug } from 'lucide-react'
import type { CenterView } from '@/stores/layout'
import { EmptyState } from '@/components/EmptyState'
import { SettingsPage } from '@/features/settings/SettingsPage'

const PLACEHOLDERS = {
  agents: {
    icon: Bot,
    title: 'Agents',
    description: 'Run several agents in parallel, each on its own branch and worktree, and review their diffs on a Kanban board.'
  },
  accounts: {
    icon: KeyRound,
    title: 'Accounts',
    description: 'Claude, Anthropic API, OpenAI, Mistral and Ollama profiles, each with its own color and label.'
  },
  mcp: {
    icon: Plug,
    title: 'MCP servers',
    description: 'Connect stdio and HTTP MCP servers, import claude_desktop_config.json, and choose which tools each agent can use.'
  },
  supervision: {
    icon: Gauge,
    title: 'Supervision',
    description: 'Active sessions, tokens, estimated cost and usage limits for every account.'
  }
} as const

export function CenterPage({ view }: { view: Exclude<CenterView, 'editor'> }) {
  if (view === 'settings') return <SettingsPage />
  const page = PLACEHOLDERS[view]
  return <EmptyState icon={page.icon} title={page.title} description={page.description} />
}
