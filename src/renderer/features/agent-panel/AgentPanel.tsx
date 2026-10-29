import { MessagesSquare } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PanelHeader } from '@/components/PanelHeader'

export function AgentPanel() {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Agent" />
      <EmptyState
        icon={MessagesSquare}
        title="No agent running"
        description="Add an account, then start an agent to chat with it here. Tool calls and approval requests will show up inline."
      />
    </div>
  )
}
