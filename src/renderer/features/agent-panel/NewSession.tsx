import { useState } from 'react'
import { FolderGit2, KeyRound, Play } from 'lucide-react'
import { PERMISSION_LEVELS, PERMISSION_LEVEL_LABELS, type PermissionLevel } from '@shared/agent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { ProfileBadge } from '@/components/ProfileBadge'
import { useAgents } from '@/stores/agents'
import { useLayout } from '@/stores/layout'
import { useProfiles } from '@/stores/profiles'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'

const LEVEL_HINTS: Record<PermissionLevel, string> = {
  'validate-all': 'Every file change and command asks first.',
  'files-auto': 'Edits inside the folder run; commands ask.',
  autonomous: 'Runs freely inside the folder. No git push.'
}

export function NewSession() {
  const profiles = useProfiles((s) => s.profiles).filter((p) => p.usable)
  const tests = useProfiles((s) => s.tests)
  const workspace = useWorkspace((s) => s.info)
  const start = useAgents((s) => s.start)
  const starting = useAgents((s) => s.starting)
  const showCenter = useLayout((s) => s.showCenter)

  const [profileId, setProfileId] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [level, setLevel] = useState<PermissionLevel>('validate-all')
  const selected = profiles.find((p) => p.id === profileId) ?? profiles[0]
  const test = selected ? tests[selected.id] : undefined
  const models = test && test !== 'testing' ? test.models : []

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title="No account yet"
        description="Add a Claude account, then start an agent to chat with it here. Tool calls and approvals show up inline."
        action={
          <Button size="sm" variant="outline" onClick={() => showCenter('accounts')}>
            Open Accounts
          </Button>
        }
      />
    )
  }

  return (
    <form
      className="flex h-full flex-col gap-5 overflow-y-auto p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (selected) void start({ profileId: selected.id, model, permissionLevel: level })
      }}
    >
      <div>
        <h2 className="text-sm font-semibold">New agent session</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Choose the account explicitly; Atelier never switches it for you.</p>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs font-medium">Account</legend>
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={selected?.id === p.id}
            onClick={() => {
              setProfileId(p.id)
              setModel('')
            }}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
              selected?.id === p.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
            )}
          >
            <ProfileBadge profile={p} className="font-medium" />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {p.auth === 'subscription' ? 'Subscription' : 'API key'}
            </span>
          </button>
        ))}
      </fieldset>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium">Model</span>
        <Input
          list="agent-models"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={selected?.defaultModel || 'default'}
          className="h-8 font-mono text-xs"
        />
        <datalist id="agent-models">
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.displayName}
            </option>
          ))}
        </datalist>
      </label>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs font-medium">Permissions</legend>
        {PERMISSION_LEVELS.map((l) => (
          <label
            key={l}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors',
              level === l ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
            )}
          >
            <input
              type="radio"
              name="permission-level"
              value={l}
              checked={level === l}
              onChange={() => setLevel(l)}
              className="mt-0.5 accent-[var(--primary)]"
            />
            <span>
              <span className="block font-medium">{PERMISSION_LEVEL_LABELS[l]}</span>
              <span className="block text-[11px] text-muted-foreground">{LEVEL_HINTS[l]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-auto space-y-2">
        <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
          <FolderGit2 className="size-3.5 shrink-0" />
          {workspace ? <span className="truncate">Works in {workspace.root}</span> : 'Open a folder first: the agent works inside it.'}
        </p>
        <Button type="submit" className="w-full" disabled={!workspace || !selected || starting}>
          <Play /> {starting ? 'Starting…' : 'Start agent'}
        </Button>
      </div>
    </form>
  )
}
