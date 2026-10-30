import { Bot, Pencil, Plus } from 'lucide-react'
import { t } from '@shared/i18n'
import { PERMISSION_LEVEL_LABELS } from '@shared/agent'
import { Button } from '@/components/ui/button'
import { ProfileDot } from '@/components/ProfileBadge'
import { useAgentDialog } from '@/stores/agent-dialog'
import { useBoard } from '@/stores/board'
import { profileById, useProfiles } from '@/stores/profiles'
import { Row } from './controls'

/** Saved agents, to create, edit or delete without going through the agent panel. */
export function SavedAgentsBlock() {
  const agents = useBoard((s) => s.agents)
  const profiles = useProfiles((s) => s.profiles)
  const openDialog = useAgentDialog((s) => s.open)
  return (
    <div>
      <Row label={t('Saved agents')} hint={t('An account, a model, instructions, a permission level and MCP tools. Choose one at the top of the agent panel.')}>
        <Button size="sm" variant="outline" onClick={() => openDialog('new')}>
          <Plus /> {t('New agent')}
        </Button>
      </Row>
      {agents.length === 0 ? (
        <p className="flex items-center gap-1.5 pb-3 text-xs text-muted-foreground">
          <Bot className="size-3.5" /> {t('No agent yet')}
        </p>
      ) : (
        <ul className="mb-3 divide-y rounded-lg border" data-testid="saved-agents">
          {agents.map((a) => {
            const profile = profileById(profiles, a.profileId)
            return (
              <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <ProfileDot color={profile?.color ?? 'var(--muted-foreground)'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {profile?.name ?? t('Deleted account')} · <span className="font-mono">{a.model || profile?.defaultModel || t('default model')}</span> ·{' '}
                    {t(PERMISSION_LEVEL_LABELS[a.permissionLevel])}
                  </span>
                </span>
                <Button size="icon-xs" variant="ghost" aria-label={t('Edit {name}', { name: a.name })} onClick={() => openDialog(a)}>
                  <Pencil />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
