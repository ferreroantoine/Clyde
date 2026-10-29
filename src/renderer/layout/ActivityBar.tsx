import { Bot, Files, Gauge, Settings, type LucideIcon } from 'lucide-react'
import { IconButton } from '@/components/IconButton'
import { t, tk } from '@shared/i18n'
import { effectiveBindings, formatCombo } from '@shared/keybindings'
import { useSettings } from '@/stores/settings'
import { useLayout, type CenterView } from '@/stores/layout'
import { cn } from '@/lib/utils'

interface Item {
  view: CenterView
  icon: LucideIcon
  label: string
  /** The keyboard command whose shortcut the tooltip shows. */
  command?: string
}

const TOP: Item[] = [
  { view: 'editor', icon: Files, label: tk('Explorer'), command: 'view.explorer' },
  { view: 'agents', icon: Bot, label: tk('Agents') },
  { view: 'supervision', icon: Gauge, label: tk('Supervision') }
]

export function ActivityBar() {
  const center = useLayout((s) => s.center)
  const sidebarOpen = useLayout((s) => s.sidebarOpen)
  const activateExplorer = useLayout((s) => s.activateExplorer)
  const showCenter = useLayout((s) => s.showCenter)

  const isActive = (view: CenterView) => (view === 'editor' ? center === 'editor' && sidebarOpen : center === view)
  const onSelect = (view: CenterView) => (view === 'editor' ? activateExplorer() : showCenter(view))

  const bindings = effectiveBindings(useSettings((s) => s.settings.shortcuts.bindings))
  const renderItem = (item: Item) => {
    const shortcut = item.command && bindings[item.command] ? formatCombo(bindings[item.command] as string) : undefined
    return (
    <div key={item.view} className="relative flex justify-center">
      <span
        className={cn(
          'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r bg-primary transition-opacity',
          isActive(item.view) ? 'opacity-100' : 'opacity-0'
        )}
      />
      <IconButton
        icon={item.icon}
        label={t(item.label)}
        {...(shortcut ? { shortcut } : {})}
        side="right"
        size="md"
        active={isActive(item.view)}
        onClick={() => onSelect(item.view)}
      />
    </div>
    )
  }

  return (
    <nav className="flex w-12 shrink-0 flex-col items-stretch justify-between border-r bg-chrome py-2">
      <div className="flex flex-col gap-1">{TOP.map(renderItem)}</div>
      <div className="flex flex-col gap-1">
        {renderItem({ view: 'settings', icon: Settings, label: tk('Settings'), command: 'view.settings' })}
      </div>
    </nav>
  )
}
