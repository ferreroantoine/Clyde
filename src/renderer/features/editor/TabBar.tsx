import { Code2, Eye, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { useEditor, type EditorTab } from '@/stores/editor'
import { FileIcon } from '@/features/explorer/FileIcon'
import { cn } from '@/lib/utils'
import { hasTextPreview } from '@/lib/viewers'

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
        className="press relative flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent"
      >
        {tab.dirty && (
          <span className="absolute size-2 rounded-full bg-foreground/70 group-hover:opacity-0" aria-label={t('Unsaved')} />
        )}
        <X className={cn('size-3.5', tab.dirty ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-70', active && !tab.dirty && 'opacity-70')} />
      </button>
    </div>
  )
}

/** Preview or code, for the active Markdown, SVG, table or JSON tab. */
function ModeSwitch({ tab }: { tab: EditorTab }) {
  const setMode = useEditor((s) => s.setMode)
  return (
    <div className="ml-auto flex shrink-0 items-center gap-px self-center rounded-md border bg-background p-px text-[11px]" role="radiogroup" aria-label={t('Display')}>
      {(
        [
          ['preview', Eye, t('Preview')],
          ['code', Code2, t('Code')]
        ] as const
      ).map(([mode, Icon, label]) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={tab.mode === mode}
          onClick={() => setMode(tab.path, mode)}
          className={cn('press flex items-center gap-1 rounded px-1.5 py-0.5', tab.mode === mode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          <Icon className="size-3" />
          {label}
        </button>
      ))}
    </div>
  )
}

export function TabBar() {
  const tabs = useEditor((s) => s.tabs)
  const active = useEditor((s) => s.active)
  const current = tabs.find((tab) => tab.path === active)
  return (
    <div className="flex h-9 shrink-0 border-b bg-chrome pr-2">
      <div role="tablist" className="flex min-w-0 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((t) => (
          <Tab key={t.path} tab={t} active={t.path === active} />
        ))}
      </div>
      {current?.status === 'ready' && current.hasText && hasTextPreview(current.viewer) && <ModeSwitch tab={current} />}
    </div>
  )
}
