import type { CenterView } from '@/stores/layout'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { AgentsPage } from '@/features/agents/AgentsPage'
import { SupervisionPage } from '@/features/supervision/SupervisionPage'
import { ChatView } from '@/features/chat/ChatView'

export function CenterPage({ view }: { view: Exclude<CenterView, 'editor'> }) {
  switch (view) {
    case 'chat':
      return <ChatView />
    case 'settings':
      return <SettingsPage />
    case 'agents':
      return <AgentsPage />
    case 'supervision':
      return <SupervisionPage />
  }
}
