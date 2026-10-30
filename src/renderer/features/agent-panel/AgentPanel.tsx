import { ChevronDown, Plus, Power, X } from 'lucide-react'
import { intlLocale, t } from '@shared/i18n'
import { PanelHeader } from '@/components/PanelHeader'
import { IconButton } from '@/components/IconButton'
import { ProfileDot } from '@/components/ProfileBadge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ENDED_STATUSES, useAgents } from '@/stores/agents'
import { profileById, useProfiles } from '@/stores/profiles'
import { NewSession } from './NewSession'
import { SessionPane, STATUS_LABELS, StatusDot } from './SessionPane'

/** "14:05" today, "28 Oct 14:05" before. */
function when(at: number): string {
  const date = new Date(at)
  const today = new Date().toDateString() === date.toDateString()
  return date.toLocaleString(intlLocale(), today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function SessionSwitcher() {
  const sessions = useAgents((s) => s.sessions)
  const order = useAgents((s) => s.order)
  const history = useAgents((s) => s.history)
  const activeId = useAgents((s) => s.activeId)
  const select = useAgents((s) => s.select)
  const open = useAgents((s) => s.open)
  const profiles = useProfiles((s) => s.profiles)
  const active = activeId ? sessions[activeId] : undefined
  const activeProfile = profileById(profiles, active?.info.profileId)
  // Sessions of earlier runs (or closed from the panel), not shown above.
  const recent = history.filter((h) => !sessions[h.id]).slice(0, 20)

  if (order.length === 0 && recent.length === 0) return <>{t('Agent')}</>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent" aria-label={t('Switch session')}>
        {active && activeProfile && <ProfileDot color={activeProfile.color} />}
        <span className="truncate">{active ? (activeProfile?.name ?? t('Agent')) : t('New session')}</span>
        <ChevronDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-72 overflow-y-auto">
        {order.map((id) => {
          const view = sessions[id]
          if (!view) return null
          const profile = profileById(profiles, view.info.profileId)
          return (
            <DropdownMenuItem key={id} onSelect={() => select(id)} className="text-xs">
              <ProfileDot color={profile?.color ?? 'var(--muted-foreground)'} />
              <span className="min-w-0 flex-1 truncate normal-case">
                {profile?.name ?? t('Deleted account')} · {view.info.model || t('default')}
              </span>
              <StatusDot status={view.info.status} />
              <span className="sr-only">{t(STATUS_LABELS[view.info.status])}</span>
            </DropdownMenuItem>
          )
        })}
        {recent.length > 0 && (
          <>
            {order.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">{t('Recent sessions of this project')}</DropdownMenuLabel>
            {recent.map((h) => {
              const profile = profileById(profiles, h.profileId)
              return (
                <DropdownMenuItem key={h.id} onSelect={() => void open(h.id)} className="items-start text-xs" data-testid="history-session">
                  <ProfileDot color={profile?.color ?? 'var(--muted-foreground)'} className="mt-1" />
                  <span className="min-w-0 flex-1 normal-case">
                    <span className="block truncate">{h.title || t('Untitled session')}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {profile?.name ?? t('Deleted account')} · {when(h.startedAt)}
                      {h.status === 'interrupted' && ` · ${t('Interrupted')}`}
                    </span>
                  </span>
                </DropdownMenuItem>
              )
            })}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => select(null)} className="text-xs">
          <Plus /> {' '}{t('New session')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AgentPanel() {
  const activeId = useAgents((s) => s.activeId)
  const view = useAgents((s) => (s.activeId ? s.sessions[s.activeId] : undefined))
  const select = useAgents((s) => s.select)
  const stop = useAgents((s) => s.stop)
  const dismiss = useAgents((s) => s.dismiss)
  const ended = view ? ENDED_STATUSES.has(view.info.status) : false

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={<SessionSwitcher />}
        actions={
          <>
            {view && !ended && <IconButton icon={Power} label={t('Stop session')} onClick={() => void stop()} />}
            {view && ended && activeId && <IconButton icon={X} label={t('Close session')} onClick={() => dismiss(activeId)} />}
            {view && <IconButton icon={Plus} label={t('New session')} onClick={() => select(null)} />}
          </>
        }
      />
      <div className="min-h-0 flex-1">{view ? <SessionPane view={view} /> : <NewSession />}</div>
    </div>
  )
}
