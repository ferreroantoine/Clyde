import { ChevronRight, LoaderCircle } from 'lucide-react'
import { t } from '@shared/i18n'
import type { DirEntry } from '@shared/types'
import { useExplorer } from '@/stores/explorer'
import { useEditor } from '@/stores/editor'
import { cn } from '@/lib/utils'
import { FileIcon } from './FileIcon'

const INDENT = 12

function Row({ entry, depth }: { entry: DirEntry; depth: number }) {
  const expanded = useExplorer((s) => !!s.expanded[entry.path])
  const selected = useExplorer((s) => s.selected === entry.path)
  const isActive = useEditor((s) => s.active === entry.path)
  const toggle = useExplorer((s) => s.toggle)
  const select = useExplorer((s) => s.select)
  const openFile = useEditor((s) => s.open)
  const isDir = entry.kind === 'dir'

  const onClick = () => {
    select(entry.path)
    if (isDir) toggle(entry.path)
    else void openFile(entry.path)
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        title={entry.path}
        style={{ paddingLeft: 8 + depth * INDENT }}
        className={cn(
          'flex h-6 w-full items-center gap-1.5 pr-2 text-left text-[13px] outline-none',
          'hover:bg-accent/70 focus-visible:bg-accent',
          selected && 'bg-accent',
          isActive && !selected && 'text-foreground',
          !isActive && !selected && 'text-foreground/85'
        )}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            !isDir && 'invisible',
            expanded && 'rotate-90'
          )}
        />
        <FileIcon name={entry.name} dir={isDir} open={expanded} />
        <span className="truncate">{entry.name}</span>
      </button>
      {isDir && expanded && <Children path={entry.path} depth={depth + 1} />}
    </>
  )
}

function Children({ path, depth }: { path: string; depth: number }) {
  const entries = useExplorer((s) => s.children[path])
  if (!entries) {
    return (
      <div style={{ paddingLeft: 8 + depth * INDENT + 20 }} className="flex h-6 items-center text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
      </div>
    )
  }
  if (entries.length === 0 && depth > 0) {
    return (
      <div style={{ paddingLeft: 8 + depth * INDENT + 20 }} className="h-6 text-xs leading-6 text-muted-foreground italic">
        {t('Empty')}</div>
    )
  }
  return (
    <>
      {entries.map((e) => (
        <Row key={e.path} entry={e} depth={depth} />
      ))}
    </>
  )
}

export function FileTree() {
  return (
    <div role="tree" className="py-1">
      <Children path="" depth={0} />
    </div>
  )
}
