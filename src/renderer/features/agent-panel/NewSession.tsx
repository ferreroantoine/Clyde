import { useMemo } from 'react'
import { t } from '@shared/i18n'
import { FolderGit2, KeyRound, MessageSquarePlus } from 'lucide-react'
import { PERMISSION_LEVEL_LABELS } from '@shared/agent'
import { EFFORT_LABELS } from '@shared/profiles'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { ProfileDot } from '@/components/ProfileBadge'
import { ModelPicker } from '@/components/ModelPicker'
import { resolveNext, type NextSession } from '@/lib/next-session'
import { useAgents } from '@/stores/agents'
import { useBoard } from '@/stores/board'
import { useLayout } from '@/stores/layout'
import { useNextSession } from '@/stores/next-session'
import { useSettings } from '@/stores/settings'
import { profileById, useProfiles } from '@/stores/profiles'
import { useWorkspace } from '@/stores/workspace'
import { AgentPicker } from './AgentPicker'
import { Composer } from './Composer'
import { SessionSettingsPopover } from './SessionSettings'

/**
 * The agent panel before a session exists: an empty thread and the usual message box. The bar
 * above chooses who answers (a saved agent or an account) and the settings of that session;
 * sending the first message starts it.
 */
export function NewSession() {
  const allProfiles = useProfiles((s) => s.profiles)
  const profiles = useMemo(() => allProfiles.filter((p) => p.usable), [allProfiles])
  const agents = useBoard((s) => s.agents)
  const workspace = useWorkspace((s) => s.info)
  const root = workspace?.root ?? ''
  const stored = useNextSession((s) => s.byProject[root])
  const save = useNextSession((s) => s.save)
  const defaultLevel = useSettings((s) => s.settings.agents.defaultPermission)
  const startWith = useAgents((s) => s.startWith)
  const starting = useAgents((s) => s.starting)
  const showSettings = useLayout((s) => s.showSettings)

  const next = resolveNext(stored, agents, profiles, defaultLevel)
  if (!next) {
    return (
      <EmptyState
        icon={KeyRound}
        title={t('No account yet')}
        description={t('Add an account, then start an agent to chat with it here. Tool calls and approvals show up inline.')}
        action={
          <Button size="sm" variant="outline" onClick={() => showSettings('accounts')}>
            {t('Open Accounts')}
          </Button>
        }
      />
    )
  }

  const change = (value: NextSession) => save(root, value)
  const profile = profileById(profiles, next.profileId)
  const agent = next.agentId ? agents.find((a) => a.id === next.agentId) : undefined
  const name = agent?.name ?? profile?.name ?? t('Agent')
  const model = next.model || profile?.defaultModel || t('default model')

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="new-session">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <AgentPicker value={next} onChange={change} defaultLevel={defaultLevel} />
        <ModelPicker
          profileId={next.profileId}
          value={{ model: next.model, effort: next.effort }}
          onChange={(choice) => change({ ...next, ...choice })}
          {...(profile?.defaultModel ? { defaultLabel: profile.defaultModel } : {})}
        />
        <span className="ml-auto">
          <SessionSettingsPopover value={next} onChange={(settings) => change({ ...next, ...settings })} kind={profile?.kind} />
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <MessageSquarePlus className="size-5 text-muted-foreground" />
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {profile && <ProfileDot color={profile.color} />}
          {t('New session with {name}', { name })}
        </p>
        <p className="text-[11px] text-muted-foreground">
          <span className="font-mono">{model}</span>
          {next.effort && ` · ${t(EFFORT_LABELS[next.effort])}`} · {t(PERMISSION_LEVEL_LABELS[next.permissionLevel])}
        </p>
        <p className="flex max-w-full items-center gap-1.5 text-[11px] text-muted-foreground">
          <FolderGit2 className="size-3.5 shrink-0" />
          {workspace ? <span className="truncate">{t('Works in {folder}', { folder: workspace.root })}</span> : t('Open a folder first: the agent works inside it.')}
        </p>
      </div>
      <Composer
        draftId=""
        canSend={!!workspace && !starting}
        placeholder={starting ? t('Starting…') : t('Ask {name}… (Enter to send)', { name })}
        onSubmit={(text) =>
          startWith(
            {
              profileId: next.profileId,
              model: next.model,
              effort: next.effort,
              permissionLevel: next.permissionLevel,
              mcpTools: next.mcpTools,
              systemPrompt: next.systemPrompt,
              ...(next.agentId ? { agentId: next.agentId } : {})
            },
            text
          )
        }
      />
    </div>
  )
}
