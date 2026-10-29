import { Eye, Plus, SquareTerminal, Trash2, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { IconButton } from '@/components/IconButton'
import { useTerminals, type TerminalTab } from '@/stores/terminals'
import { useLayout } from '@/stores/layout'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { TerminalView } from './TerminalView'

function Tab({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const activate = useTerminals((s) => s.activate)
  const close = useTerminals((s) => s.close)
  const Icon = tab.kind === 'agent' ? Eye : SquareTerminal
  return (
    <div
      role="tab"
      aria-selected={active}
      title={tab.cwd}
      onClick={() => activate(tab.id)}
      className={cn(
        'group flex h-7 cursor-default items-center gap-1.5 rounded-md pr-1 pl-2 text-xs',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
      <span className={cn(tab.exitCode !== null && 'line-through opacity-60')}>{tab.title}</span>
      <button
        type="button"
        aria-label={`Close ${tab.title}`}
        onClick={(e) => {
          e.stopPropagation()
          void close(tab.id)
        }}
        className="flex size-4 items-center justify-center rounded opacity-0 group-hover:opacity-70 hover:bg-background"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

export function TerminalPanel() {
  const tabs = useTerminals((s) => s.tabs)
  const active = useTerminals((s) => s.active)
  const create = useTerminals((s) => s.create)
  const close = useTerminals((s) => s.close)
  const open = useLayout((s) => s.terminalOpen)
  const workspaceReady = useWorkspace((s) => s.ready)
  const root = useWorkspace((s) => s.info?.root)

  // Like VS Code, showing the panel with no terminal starts one, in the workspace when there is one.
  useEffect(() => {
    if (open && workspaceReady && useTerminals.getState().tabs.length === 0) void create()
  }, [open, workspaceReady, root, create])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2">
        <div role="tablist" className="flex min-w-0 items-center gap-1 overflow-x-auto">
          <span className="px-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {t('Terminal')}</span>
          {tabs.map((t) => (
            <Tab key={t.id} tab={t} active={t.id === active} />
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton icon={Plus} label={t('New terminal')} onClick={() => void create()} />
          <IconButton
            icon={Trash2}
            label={t('Kill terminal')}
            disabled={!active}
            onClick={() => active && void close(active)}
          />
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.length === 0 ? (
          <EmptyState
            icon={SquareTerminal}
            title={t('No terminal')}
            action={
              <Button size="sm" variant="outline" onClick={() => void create()}>
                {t('New terminal')}</Button>
            }
          />
        ) : (
          tabs.map((t) => (
            <div key={t.id} className={cn('absolute inset-0', t.id !== active && 'invisible')}>
              <TerminalView id={t.id} focused={t.id === active && open} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
