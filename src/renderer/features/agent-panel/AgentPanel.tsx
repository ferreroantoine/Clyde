import { ChevronDown, Plus, Power, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { PanelHeader } from '@/components/PanelHeader'
import { IconButton } from '@/components/IconButton'
import { ProfileDot } from '@/components/ProfileBadge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ENDED_STATUSES, useAgents } from '@/stores/agents'
import { profileById, useProfiles } from '@/stores/profiles'
import { NewSession } from './NewSession'
import { SessionPane, STATUS_LABELS, StatusDot } from './SessionPane'

function SessionSwitcher() {
  const sessions = useAgents((s) => s.sessions)
  const order = useAgents((s) => s.order)
  const activeId = useAgents((s) => s.activeId)
  const select = useAgents((s) => s.select)
  const profiles = useProfiles((s) => s.profiles)
  const active = activeId ? sessions[activeId] : undefined
  const activeProfile = profileById(profiles, active?.info.profileId)

  if (order.length === 0) return <>{t('Agent')}</>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent" aria-label={t('Switch session')}>
        {active && activeProfile && <ProfileDot color={activeProfile.color} />}
        <span className="truncate">{active ? (activeProfile?.name ?? t('Agent')) : t('New session')}</span>
        <ChevronDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
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
