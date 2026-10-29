import { useState, type ReactNode } from 'react'
import { Check, KeyRound, UserRound } from 'lucide-react'
import { PROFILE_COLORS, type ClaudeAuthMode, type Profile } from '@shared/profiles'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useProfiles } from '@/stores/profiles'
import { cn } from '@/lib/utils'

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  )
}

function AuthOption({
  active,
  disabled,
  icon: Icon,
  title,
  description,
  onClick
}: {
  active: boolean
  disabled?: boolean
  icon: typeof KeyRound
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edits this profile; creates a new one when absent. */
  profile?: Profile
  distribution: boolean
  onCreated?: (profile: Profile) => void
}

export function ProfileDialog({ open, onOpenChange, ...props }: ProfileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted per opening, so the form starts from the profile every time. */}
        <ProfileForm {...props} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function nextColor(): string {
  return PROFILE_COLORS[useProfiles.getState().profiles.length % PROFILE_COLORS.length] ?? PROFILE_COLORS[0]
}

function ProfileForm({
  profile,
  distribution,
  onCreated,
  close
}: Omit<ProfileDialogProps, 'open' | 'onOpenChange'> & { close: () => void }) {
  const create = useProfiles((s) => s.create)
  const update = useProfiles((s) => s.update)
  const test = useProfiles((s) => s.tests[profile?.id ?? ''])
  const models = test && test !== 'testing' ? test.models : []

  const [name, setName] = useState(profile?.name ?? '')
  const [label, setLabel] = useState(profile?.label ?? '')
  const [color, setColor] = useState<string>(() => profile?.color ?? nextColor())
  const [auth, setAuth] = useState<ClaudeAuthMode>(profile?.auth ?? (distribution ? 'api-key' : 'subscription'))
  const [apiKey, setApiKey] = useState('')
  const [defaultModel, setDefaultModel] = useState(profile?.defaultModel ?? '')
  const [saving, setSaving] = useState(false)

  const editing = !!profile
  const needsKey = auth === 'api-key' && !editing
  const canSave = name.trim().length > 0 && (!needsKey || apiKey.trim().length > 0) && !saving

  const save = async () => {
    setSaving(true)
    const common = { name, label, color: color as (typeof PROFILE_COLORS)[number], defaultModel }
    const key = apiKey.trim() ? { apiKey: apiKey.trim() } : {}
    const saved = editing
      ? await update({ id: profile.id, ...common, ...key })
      : await create({ kind: 'claude-code', auth, ...common, ...key })
    setSaving(false)
    if (!saved) return
    close()
    if (!editing) onCreated?.(saved)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit account' : 'Add a Claude account'}</DialogTitle>
        <DialogDescription>
          Each account gets its own Claude Code configuration folder, so several accounts can work side by side.
        </DialogDescription>
      </DialogHeader>

      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSave) void save()
        }}
      >
        {!editing && (
          <div className="grid grid-cols-2 gap-2">
            <AuthOption
              active={auth === 'subscription'}
              disabled={distribution}
              icon={UserRound}
              title="Claude subscription"
              description={distribution ? 'Not available in this build.' : 'Sign in with Claude Code. Personal use.'}
              onClick={() => setAuth('subscription')}
            />
            <AuthOption
              active={auth === 'api-key'}
              icon={KeyRound}
              title="Anthropic API key"
              description="Billed to your Console organization."
              onClick={() => setAuth('api-key')}
            />
          </div>
        )}

        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Claude perso"
              maxLength={60}
            />
          </Field>
          <Field label="Label">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="PERSO" maxLength={12} />
          </Field>
        </div>

        <Field label="Color">
          <div className="flex flex-wrap gap-1.5">
            {PROFILE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className="flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                style={{
                  backgroundColor: c,
                  boxShadow: color === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : undefined
                }}
              >
                {color === c && <Check className="size-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Field>

        {auth === 'api-key' && (
          <Field
            label={editing ? 'Replace API key' : 'API key'}
            hint="Encrypted with the operating system's secure storage. It never leaves the main process."
          >
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={editing && profile.hasApiKey ? 'Stored, leave empty to keep it' : 'sk-ant-…'}
              className="font-mono text-xs"
            />
          </Field>
        )}

        <Field
          label="Default model"
          hint={models.length ? undefined : 'Empty uses Claude Code’s default. Test the connection to list models.'}
        >
          <Input
            list="profile-models"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="default"
            className="font-mono text-xs"
          />
          <datalist id="profile-models">
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.displayName}
              </option>
            ))}
          </datalist>
        </Field>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSave}>
            {editing ? 'Save' : 'Add account'}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
