import { useRef } from 'react'
import { Bot, Check, ChevronDown, Pencil, Plus } from 'lucide-react'
import { t } from '@shared/i18n'
import type { PermissionLevel } from '@shared/agent'
import { kindLabel } from '@shared/profiles'
import type { AgentDefinition } from '@shared/tasks'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ProfileDot } from '@/components/ProfileBadge'
import { fromAgent, fromProfile, type NextSession } from '@/lib/next-session'
import { useAgentDialog } from '@/stores/agent-dialog'
import { useSavedAgents } from '@/stores/saved-agents'
import { profileById, useProfiles } from '@/stores/profiles'

/**
 * Who answers the first message: a saved agent (with its settings) or an account as it is.
 * Also where agents are created ("+") and edited (the pencil).
 */
export function AgentPicker({ value, onChange, defaultLevel }: { value: NextSession; onChange: (next: NextSession) => void; defaultLevel: PermissionLevel }) {
  const agents = useSavedAgents((s) => s.agents)
  const profiles = useProfiles((s) => s.profiles).filter((p) => p.usable)
  const openDialog = useAgentDialog((s) => s.open)
  const agent = value.agentId ? agents.find((a) => a.id === value.agentId) : undefined
  const profile = profileById(profiles, value.profileId)
  // The pencil sits inside the menu item: a press on it edits the agent instead of choosing it.
  const editing = useRef<AgentDefinition | null>(null)
  const created = (saved: AgentDefinition) => onChange(fromAgent(saved))

  return (
    <DropdownMenu onOpenChange={() => (editing.current = null)}>
      <DropdownMenuTrigger
        className="press flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent/60"
        style={profile ? { borderColor: `color-mix(in oklab, ${profile.color} 45%, var(--border))` } : undefined}
        aria-label={t('Who answers')}
        data-testid="agent-picker"
      >
        {profile && <ProfileDot color={profile.color} />}
        {agent && <Bot className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate font-medium">{agent?.name ?? profile?.name ?? t('Choose an agent or an account')}</span>
        {agent && profile && <span className="truncate text-[11px] text-muted-foreground">{profile.name}</span>}
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-72 overflow-y-auto">
        {agents.length > 0 && (
          <>
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">{t('Agents')}</DropdownMenuLabel>
            {agents.map((a) => {
              const p = profileById(profiles, a.profileId)
              if (!p) return null
              return (
                <DropdownMenuItem
                  key={a.id}
                  className="group/agent text-xs"
                  onSelect={() => {
                    if (editing.current) openDialog(editing.current)
                    else onChange(fromAgent(a))
                    editing.current = null
                  }}
                >
                  <ProfileDot color={p.color} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{a.name}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">{a.model || p.defaultModel || t('default model')}</span>
                  </span>
                  {value.agentId === a.id && <Check className="size-3.5" />}
                  <span
                    role="button"
                    aria-label={t('Edit {name}', { name: a.name })}
                    title={t('Edit {name}', { name: a.name })}
                    onPointerDown={() => (editing.current = a)}
                    className="rounded p-0.5 text-muted-foreground opacity-0 group-hover/agent:opacity-100 group-data-[highlighted]/agent:opacity-100 hover:bg-background hover:text-foreground"
                  >
                    <Pencil className="size-3" />
                  </span>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">{t('Accounts')}</DropdownMenuLabel>
        {profiles.map((p) => (
          <DropdownMenuItem key={p.id} className="text-xs" onSelect={() => onChange(fromProfile(p.id, value.agentId ? defaultLevel : value.permissionLevel))}>
            <ProfileDot color={p.color} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{p.name}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {kindLabel(p.kind)}
                {p.defaultModel && <span className="font-mono"> · {p.defaultModel}</span>}
              </span>
            </span>
            {!value.agentId && value.profileId === p.id && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onSelect={() => openDialog('new', created)}>
          <Plus /> {t('New agent')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
