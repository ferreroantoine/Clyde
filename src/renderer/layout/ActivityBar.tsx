import { Bot, Files, Gauge, KeyRound, Plug, Settings, type LucideIcon } from 'lucide-react'
import { IconButton } from '@/components/IconButton'
import { useLayout, type CenterView } from '@/stores/layout'
import { cn } from '@/lib/utils'

interface Item {
  view: CenterView
  icon: LucideIcon
  label: string
  shortcut?: string
}

const TOP: Item[] = [
  { view: 'editor', icon: Files, label: 'Explorer', shortcut: 'Ctrl+Shift+E' },
  { view: 'agents', icon: Bot, label: 'Agents' },
  { view: 'accounts', icon: KeyRound, label: 'Accounts' },
  { view: 'mcp', icon: Plug, label: 'MCP servers' },
  { view: 'supervision', icon: Gauge, label: 'Supervision' }
]

export function ActivityBar() {
  const center = useLayout((s) => s.center)
  const sidebarOpen = useLayout((s) => s.sidebarOpen)
  const activateExplorer = useLayout((s) => s.activateExplorer)
  const showCenter = useLayout((s) => s.showCenter)

  const isActive = (view: CenterView) => (view === 'editor' ? center === 'editor' && sidebarOpen : center === view)
  const onSelect = (view: CenterView) => (view === 'editor' ? activateExplorer() : showCenter(view))

  const renderItem = (item: Item) => (
    <div key={item.view} className="relative flex justify-center">
      <span
        className={cn(
          'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r bg-primary transition-opacity',
          isActive(item.view) ? 'opacity-100' : 'opacity-0'
        )}
      />
      <IconButton
        icon={item.icon}
        label={item.label}
        {...(item.shortcut ? { shortcut: item.shortcut } : {})}
        side="right"
        size="md"
        active={isActive(item.view)}
        onClick={() => onSelect(item.view)}
      />
    </div>
  )

  return (
    <nav className="flex w-12 shrink-0 flex-col items-stretch justify-between border-r bg-chrome py-2">
      <div className="flex flex-col gap-1">{TOP.map(renderItem)}</div>
      <div className="flex flex-col gap-1">
        {renderItem({ view: 'settings', icon: Settings, label: 'Settings', shortcut: 'Ctrl+,' })}
      </div>
    </nav>
  )
}
