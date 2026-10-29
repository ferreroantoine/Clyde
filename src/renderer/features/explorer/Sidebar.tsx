import { ChevronsDownUp, FolderOpen, RefreshCw } from 'lucide-react'
import { IconButton } from '@/components/IconButton'
import { useLayout, type SidebarTab } from '@/stores/layout'
import { useWorkspace } from '@/stores/workspace'
import { useExplorer } from '@/stores/explorer'
import { SearchView } from '@/features/search/SearchView'
import { cn } from '@/lib/utils'
import { FileTree } from './FileTree'
import { NoWorkspace } from './NoWorkspace'

const TABS: Array<{ id: SidebarTab; label: string }> = [
  { id: 'files', label: 'Files' },
  { id: 'search', label: 'Search' }
]

export function Sidebar() {
  const tab = useLayout((s) => s.sidebarTab)
  const showTab = useLayout((s) => s.showSidebarTab)
  const info = useWorkspace((s) => s.info)
  const pick = useWorkspace((s) => s.pick)
  const refresh = useExplorer((s) => s.refresh)
  const collapseAll = useExplorer((s) => s.collapseAll)

  if (!info) return <NoWorkspace />

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-2">
        <div className="flex items-center gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => showTab(t.id)}
              className={cn(
                'rounded-md px-2 py-1 text-xs transition-colors',
                tab === t.id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'files' && (
          <div className="flex items-center gap-0.5">
            <IconButton icon={FolderOpen} label="Open folder" onClick={() => void pick()} />
            <IconButton icon={RefreshCw} label="Refresh" onClick={() => void refresh()} />
            <IconButton icon={ChevronsDownUp} label="Collapse all" onClick={collapseAll} />
          </div>
        )}
      </div>
      {tab === 'files' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            className="truncate px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
            title={info.root}
          >
            {info.name}
          </div>
          <FileTree />
        </div>
      ) : (
        <SearchView />
      )}
    </div>
  )
}
