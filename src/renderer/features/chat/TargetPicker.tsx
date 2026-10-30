import { Bot, Check, ChevronDown } from 'lucide-react'
import { t } from '@shared/i18n'
import { EFFORT_LABELS, kindLabel } from '@shared/profiles'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ProfileBadge, ProfileDot } from '@/components/ProfileBadge'
import { useBoard } from '@/stores/board'
import { useProfiles, profileById } from '@/stores/profiles'
import type { ChatTarget } from '@/stores/chat'
import { cn } from '@/lib/utils'
import { ModelPicker } from '@/components/ModelPicker'

/** The agent, or the account and model, that answers; colored like the account. */
export function TargetPicker({ target, onChange }: { target: ChatTarget | null; onChange: (target: ChatTarget) => void }) {
  const agents = useBoard((s) => s.agents)
  const profiles = useProfiles((s) => s.profiles).filter((p) => p.usable)
  const agent = target?.agentId ? agents.find((a) => a.id === target.agentId) : undefined
  const profile = profileById(profiles, target?.profileId)

  return (
    <div className="flex min-w-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="press flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-[13px] shadow-xs hover:bg-accent/60"
            style={profile ? { borderColor: `color-mix(in oklab, ${profile.color} 45%, var(--border))` } : undefined}
            aria-label={t('Who answers')}
          >
            {agent ? <Bot className="size-3.5 shrink-0 text-muted-foreground" /> : null}
            {agent && <span className="truncate font-medium">{agent.name}</span>}
            {profile ? (
              <ProfileBadge profile={profile} className={cn(agent && 'text-xs text-muted-foreground')} />
            ) : (
              <span className="text-muted-foreground">{t('Choose an agent or an account')}</span>
            )}
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
          {agents.length > 0 && (
            <>
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">{t('Saved agents')}</DropdownMenuLabel>
              {agents.map((a) => {
                const p = profileById(profiles, a.profileId)
                if (!p) return null
                return (
                  <DropdownMenuItem key={a.id} onSelect={() => onChange({ agentId: a.id, profileId: a.profileId, model: a.model, effort: a.effort })}>
                    <ProfileDot color={p.color} />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{p.name}</span>
                    {target?.agentId === a.id && <Check className="size-3.5" />}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">{t('Accounts')}</DropdownMenuLabel>
          {profiles.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('Add an account in Settings first.')}</p>}
          {profiles.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => onChange({ agentId: null, profileId: p.id, model: p.defaultModel, effort: '' })}>
              <ProfileDot color={p.color} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="truncate text-[11px] text-muted-foreground">{kindLabel(p.kind)}</span>
              {!target?.agentId && target?.profileId === p.id && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {target && !agent && (
        <ModelPicker
          profileId={target.profileId}
          value={{ model: target.model, effort: target.effort ?? '' }}
          onChange={(choice) => onChange({ ...target, ...choice })}
          {...(profile?.defaultModel ? { defaultLabel: profile.defaultModel } : {})}
        />
      )}
      {agent && (
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {agent.model || t('default model')}
          {agent.effort && ` · ${t(EFFORT_LABELS[agent.effort])}`}
        </span>
      )}
    </div>
  )
}
