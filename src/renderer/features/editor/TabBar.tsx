import { X } from 'lucide-react'
import { t } from '@shared/i18n'
import { useEditor, type EditorTab } from '@/stores/editor'
import { FileIcon } from '@/features/explorer/FileIcon'
import { cn } from '@/lib/utils'

function Tab({ tab, active }: { tab: EditorTab; active: boolean }) {
  const activate = useEditor((s) => s.activate)
  const close = useEditor((s) => s.close)

  return (
    <div
      role="tab"
      aria-selected={active}
      title={tab.path}
      onClick={() => activate(tab.path)}
      onAuxClick={(e) => e.button === 1 && close(tab.path)}
      className={cn(
        'group relative flex h-full max-w-56 shrink-0 cursor-default items-center gap-1.5 border-r pr-1.5 pl-3 text-[13px]',
        active ? 'bg-editor text-foreground' : 'text-muted-foreground hover:bg-accent/50'
      )}
    >
      {active && <span className="absolute inset-x-0 top-0 h-px bg-primary" />}
      <FileIcon name={tab.name} className="size-3.5" />
      <span className={cn('truncate', tab.conflict === 'deleted' && 'line-through')}>{tab.name}</span>
      <button
        type="button"
        aria-label={`Close ${tab.name}`}
        onClick={(e) => {
          e.stopPropagation()
          close(tab.path)
        }}
        className="relative flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent"
      >
        {tab.dirty && (
          <span className="absolute size-2 rounded-full bg-foreground/70 group-hover:opacity-0" aria-label={t('Unsaved')} />
        )}
        <X className={cn('size-3.5', tab.dirty ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-70', active && !tab.dirty && 'opacity-70')} />
      </button>
    </div>
  )
}

export function TabBar() {
  const tabs = useEditor((s) => s.tabs)
  const active = useEditor((s) => s.active)
  return (
    <div role="tablist" className="flex h-9 shrink-0 overflow-x-auto border-b bg-chrome [scrollbar-width:none]">
      {tabs.map((t) => (
        <Tab key={t.path} tab={t} active={t.path === active} />
      ))}
    </div>
  )
}
