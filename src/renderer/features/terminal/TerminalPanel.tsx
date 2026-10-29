import { SquareTerminal } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PanelHeader } from '@/components/PanelHeader'

export function TerminalPanel() {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Terminal" />
      <EmptyState icon={SquareTerminal} title="No terminal" />
    </div>
  )
}
