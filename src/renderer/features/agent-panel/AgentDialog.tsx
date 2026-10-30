import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { PermissionLevel } from '@shared/agent'
import type { AgentDefinition } from '@shared/tasks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ProfileBadge } from '@/components/ProfileBadge'
import { ModelPicker, type ModelChoice } from '@/components/ModelPicker'
import { useAgentDialog } from '@/stores/agent-dialog'
import { useBoard } from '@/stores/board'
import { useSettings } from '@/stores/settings'
import { useProfiles } from '@/stores/profiles'
import { cn } from '@/lib/utils'
import { McpPicker, PermissionPicker } from './SessionSettings'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </div>
  )
}

/** The app's one agent dialog (see useAgentDialog): create, edit or delete a saved agent. */
export function AgentDialogHost() {
  const editing = useAgentDialog((s) => s.editing)
  const close = useAgentDialog((s) => s.close)
  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {editing && <AgentForm key={editing === 'new' ? 'new' : editing.id} {...(editing !== 'new' ? { agent: editing } : {})} close={close} />}
      </DialogContent>
    </Dialog>
  )
}

function AgentForm({ agent, close }: { agent?: AgentDefinition; close: () => void }) {
  const profiles = useProfiles((s) => s.profiles).filter((p) => p.usable)
  const saveAgent = useBoard((s) => s.saveAgent)
  const deleteAgent = useBoard((s) => s.deleteAgent)
  const [name, setName] = useState(agent?.name ?? '')
  const [profileId, setProfileId] = useState(agent?.profileId ?? profiles[0]?.id ?? '')
  const [choice, setChoice] = useState<ModelChoice>({ model: agent?.model ?? '', effort: agent?.effort ?? '' })
  const [level, setLevel] = useState<PermissionLevel>(agent?.permissionLevel ?? useSettings.getState().settings.agents.defaultPermission)
  const [prompt, setPrompt] = useState(agent?.systemPrompt ?? '')
  const [mcpTools, setMcpTools] = useState(new Set(agent?.mcpTools ?? []))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const profile = profiles.find((p) => p.id === profileId)

  const save = async () => {
    const input = { name, profileId, model: choice.model, effort: choice.effort, permissionLevel: level, systemPrompt: prompt, mcpTools: [...mcpTools] }
    const saved = await saveAgent(agent ? { id: agent.id, ...input } : input)
    if (!saved) return
    useAgentDialog.getState().onSaved?.(saved)
    close()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{agent ? t('Edit {name}', { name: agent.name }) : t('New agent')}</DialogTitle>
        <DialogDescription>{t('An agent is an account, a model, instructions, a permission level and its MCP tools.')}</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() && profileId) void save()
        }}
      >
        <Field label={t('Name')}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Reviewer')} maxLength={60} />
        </Field>
        <Field label={t('Account')}>
          <div className="grid gap-1.5" role="radiogroup" aria-label={t('Account')}>
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={profileId === p.id}
                onClick={() => {
                  if (p.id !== profileId) setChoice({ model: '', effort: '' })
                  setProfileId(p.id)
                }}
                className={cn(
                  'press rounded-lg border px-3 py-1.5 text-left text-xs',
                  profileId === p.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
                )}
              >
                <ProfileBadge profile={p} />
              </button>
            ))}
            {profiles.length === 0 && <p className="text-xs text-muted-foreground">{t('Add an account first.')}</p>}
          </div>
        </Field>
        <Field label={t('Model and reasoning')}>
          <ModelPicker profileId={profileId || null} value={choice} onChange={setChoice} {...(profile?.defaultModel ? { defaultLabel: profile.defaultModel } : {})} />
        </Field>
        <Field label={t('Permissions')}>
          <PermissionPicker value={level} onChange={setLevel} kind={profile?.kind} name="agent-level" />
        </Field>
        <Field label={t('MCP tools')}>
          <McpPicker value={mcpTools} onChange={setMcpTools} />
        </Field>
        <Field label={t('System prompt')}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('How this agent works, e.g. “Write tests first. Keep changes small.”')}
            aria-label={t('System prompt')}
            className="min-h-20 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>
        <DialogFooter className="items-center">
          {agent && (
            <Button
              type="button"
              variant={confirmDelete ? 'destructive' : 'ghost'}
              className="sm:mr-auto"
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true)
                void deleteAgent(agent.id).then(close)
              }}
            >
              <Trash2 /> {confirmDelete ? t('Delete {name}', { name: agent.name }) : t('Delete')}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={close}>
            {t('Cancel')}
          </Button>
          <Button type="submit" disabled={!name.trim() || !profileId}>
            {agent ? t('Save') : t('Create agent')}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
