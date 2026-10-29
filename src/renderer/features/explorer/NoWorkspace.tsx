import { FolderOpen, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { useSettings } from '@/stores/settings'
import { useWorkspace } from '@/stores/workspace'

const shortName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

export function NoWorkspace() {
  const recent = useSettings((s) => s.settings.general.recentWorkspaces)
  const pick = useWorkspace((s) => s.pick)
  const open = useWorkspace((s) => s.open)

  return (
    <div className="flex h-full flex-col">
      <EmptyState
        className="h-auto pt-16"
        icon={FolderOpen}
        title="No folder open"
        description="Open a folder or repository to browse its files."
        action={
          <Button size="sm" onClick={() => void pick()}>
            Open folder
          </Button>
        }
      />
      {recent.length > 0 && (
        <div className="mt-8 px-3">
          <p className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <History className="size-3" /> Recent
          </p>
          {recent.map((path) => (
            <button
              key={path}
              type="button"
              title={path}
              onClick={() => void open(path)}
              className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent"
            >
              <span className="truncate text-[13px]">{shortName(path)}</span>
              <span className="truncate text-[11px] text-muted-foreground">{path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
