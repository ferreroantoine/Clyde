import { motion } from 'motion/react'
import { spring } from '@/lib/motion'
import { Bot, Files, Gauge, GitBranch, MessagesSquare, Settings, type LucideIcon } from 'lucide-react'
import { IconButton } from '@/components/IconButton'
import { t, tk } from '@shared/i18n'
import { effectiveBindings, formatCombo } from '@shared/keybindings'
import { useSettings } from '@/stores/settings'
import { useLayout, type CenterView } from '@/stores/layout'
import { useGit } from '@/stores/git'

interface Item {
  view: CenterView
  icon: LucideIcon
  label: string
  /** The keyboard command whose shortcut the tooltip shows. */
  command?: string
}

const TOP: Item[] = [
  { view: 'chat', icon: MessagesSquare, label: tk('Chat'), command: 'view.chat' },
  { view: 'editor', icon: Files, label: tk('Explorer'), command: 'view.explorer' },
  { view: 'agents', icon: Bot, label: tk('Agents') },
  { view: 'supervision', icon: Gauge, label: tk('Supervision') }
]

export function ActivityBar() {
  const center = useLayout((s) => s.center)
  const sidebarOpen = useLayout((s) => s.sidebarOpen)
  const sidebarTab = useLayout((s) => s.sidebarTab)
  const activateExplorer = useLayout((s) => s.activateExplorer)
  const showCenter = useLayout((s) => s.showCenter)
  const showSidebarTab = useLayout((s) => s.showSidebarTab)
  const setSidebarOpen = useLayout((s) => s.setSidebarOpen)
  const changes = useGit((s) => (s.status ? s.status.staged.length + s.status.unstaged.length + s.status.untracked.length + s.status.conflicts.length : 0))

  const sourceActive = center === 'editor' && sidebarOpen && sidebarTab === 'git'
  const isActive = (view: CenterView) => (view === 'editor' ? center === 'editor' && sidebarOpen && sidebarTab !== 'git' : center === view)
  const onSelect = (view: CenterView) => {
    if (view !== 'editor') return showCenter(view)
    // From the Source view, the Explorer comes back instead of the sidebar closing.
    if (sidebarTab === 'git') showSidebarTab('files')
    else activateExplorer()
  }
  const onSource = () => (sourceActive ? setSidebarOpen(false) : showSidebarTab('git'))

  const bindings = effectiveBindings(useSettings((s) => s.settings.shortcuts.bindings))
  const renderItem = (item: Item) => {
    const shortcut = item.command && bindings[item.command] ? formatCombo(bindings[item.command] as string) : undefined
    return (
    <div key={item.view} className="relative flex justify-center">
      {isActive(item.view) && (
        // One indicator that glides from the previous item to the new one.
        <motion.span layoutId="activity-indicator" transition={spring.layout} className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r bg-primary" />
      )}
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
      <div className="flex flex-col gap-1">
        {TOP.slice(0, 2).map(renderItem)}
        <div className="relative flex justify-center">
          {sourceActive && <motion.span layoutId="activity-indicator" transition={spring.layout} className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r bg-primary" />}
          <IconButton
            icon={GitBranch}
            label={t('Source control')}
            {...(bindings['view.source'] ? { shortcut: formatCombo(bindings['view.source']) } : {})}
            side="right"
            size="md"
            active={sourceActive}
            onClick={onSource}
          />
          {changes > 0 && (
            <span className="pointer-events-none absolute right-1 bottom-1 min-w-3.5 rounded-full bg-primary px-1 text-center text-[9px] leading-3.5 font-semibold text-primary-foreground tabular-nums">
              {changes > 99 ? '99+' : changes}
            </span>
          )}
        </div>
        {TOP.slice(2).map(renderItem)}
      </div>
      <div className="flex flex-col gap-1">
        {renderItem({ view: 'settings', icon: Settings, label: tk('Settings'), command: 'view.settings' })}
      </div>
    </nav>
  )
}
