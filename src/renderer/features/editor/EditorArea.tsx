import { Code2 } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

export function EditorArea() {
  return <EmptyState icon={Code2} title="No file open" description="Pick a file in the explorer to open it here." />
}
