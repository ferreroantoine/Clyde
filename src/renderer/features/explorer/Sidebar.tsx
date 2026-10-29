import { FolderOpen } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PanelHeader } from '@/components/PanelHeader'

export function Sidebar() {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Explorer" />
      <EmptyState icon={FolderOpen} title="No folder open" description="Open a folder or repository to browse its files." />
    </div>
  )
}
