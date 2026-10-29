import type { CenterView } from '@/stores/layout'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { AgentsPage } from '@/features/agents/AgentsPage'
import { SupervisionPage } from '@/features/supervision/SupervisionPage'

export function CenterPage({ view }: { view: Exclude<CenterView, 'editor'> }) {
  switch (view) {
    case 'settings':
      return <SettingsPage />
    case 'agents':
      return <AgentsPage />
    case 'supervision':
      return <SupervisionPage />
  }
}
