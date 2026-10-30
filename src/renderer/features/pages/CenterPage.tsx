import type { CenterView } from '@/stores/layout'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { TasksPage } from '@/features/tasks/TasksPage'
import { SupervisionPage } from '@/features/supervision/SupervisionPage'
import { ChatView } from '@/features/chat/ChatView'

export function CenterPage({ view }: { view: Exclude<CenterView, 'editor'> }) {
  switch (view) {
    case 'chat':
      return <ChatView />
    case 'settings':
      return <SettingsPage />
    case 'tasks':
      return <TasksPage />
    case 'supervision':
      return <SupervisionPage />
  }
}
