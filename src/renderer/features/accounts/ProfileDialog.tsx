import { useState, type ReactNode } from 'react'
import { t, tk } from '@shared/i18n'
import { Bot, Check, Cpu, Gem, KeyRound, Orbit, Sparkles, SquareTerminal, UserRound } from 'lucide-react'
import {
  DEFAULT_OLLAMA_URL,
  isCliKind,
  PROFILE_COLORS,
  PROVIDER_FAMILIES,
  SINGLE_PROFILE_KINDS,
  type AuthMode,
  type Profile,
  type ProfileKind
} from '@shared/profiles'
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

interface Choice {
  kind: ProfileKind
  auth: AuthMode
  icon: typeof KeyRound
  title: string
  description: string
  keyPlaceholder?: string
}

/** Every way to add an account, grouped by vendor in the order the dialog shows them. */
const CHOICES: Choice[] = [
  {
    kind: 'claude-code',
    auth: 'subscription',
    icon: UserRound,
    title: tk('Claude subscription'),
    description: tk('Claude Code, signed in with your plan. Personal use.')
  },
  {
    kind: 'claude-code',
    auth: 'api-key',
    icon: KeyRound,
    title: tk('Claude Code + API key'),
    description: tk('Claude Code, billed to a Console key.'),
    keyPlaceholder: 'sk-ant-…'
  },
  {
    kind: 'anthropic',
    auth: 'api-key',
    icon: Sparkles,
    title: tk('Anthropic API'),
    description: tk('Claude models in Atelier’s own agent loop.'),
    keyPlaceholder: 'sk-ant-…'
  },
  {
    kind: 'codex',
    auth: 'subscription',
    icon: SquareTerminal,
    title: tk('ChatGPT subscription'),
    description: tk('Codex CLI, signed in with your ChatGPT plan. Personal use.')
  },
  { kind: 'openai', auth: 'api-key', icon: Bot, title: tk('OpenAI API'), description: tk('GPT models in Atelier’s own loop.'), keyPlaceholder: 'sk-…' },
  {
    kind: 'antigravity',
    auth: 'subscription',
    icon: Orbit,
    title: tk('Google subscription'),
    description: tk('Antigravity CLI, signed in with your Google account. Personal use.')
  },
  {
    kind: 'gemini',
    auth: 'api-key',
    icon: Gem,
    title: tk('Gemini API'),
    description: tk('Gemini models with an AI Studio key.'),
    keyPlaceholder: 'AIza…'
  },
  { kind: 'ollama', auth: 'none', icon: Cpu, title: tk('Ollama'), description: tk('Local models, no key.') }
]

/** What the dialog says about each kind, under its title. */
function kindDescription(kind: ProfileKind): string {
  switch (kind) {
    case 'claude-code':
      return t('Each Claude Code account gets its own configuration folder, so several accounts can work side by side.')
    case 'codex':
      return t('Each Codex account gets its own CODEX_HOME folder, so several ChatGPT accounts can work side by side.')
    case 'antigravity':
      return t('Antigravity keeps its sign-in in the Windows credential store, once per Windows user, so Atelier allows one Antigravity account.')
    default:
      return t('Runs Atelier’s own agent loop: read, write, list files and run commands, plus the MCP tools you allow.')
  }
}

const choiceOf = (kind: ProfileKind, auth: AuthMode) =>
  CHOICES.find((c) => c.kind === kind && c.auth === auth) ?? (CHOICES[0] as Choice)

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
        'flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="space-y-0.5">
        <span className="block text-[13px] font-medium">{title}</span>
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
  const profiles = useProfiles((s) => s.profiles)
  const update = useProfiles((s) => s.update)
  const test = useProfiles((s) => s.tests[profile?.id ?? ''])
  const models = test && test !== 'testing' ? test.models : []

  const [name, setName] = useState(profile?.name ?? '')
  const [label, setLabel] = useState(profile?.label ?? '')
  const [color, setColor] = useState<string>(() => profile?.color ?? nextColor())
  const [choice, setChoice] = useState<Choice>(() =>
    profile ? choiceOf(profile.kind, profile.auth) : choiceOf('claude-code', distribution ? 'api-key' : 'subscription')
  )
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? '')
  const [defaultModel, setDefaultModel] = useState(profile?.defaultModel ?? '')
  const [saving, setSaving] = useState(false)

  const editing = !!profile
  const { kind, auth } = choice
  const needsKey = auth === 'api-key' && !editing
  const canSave = name.trim().length > 0 && (!needsKey || apiKey.trim().length > 0) && !saving

  const save = async () => {
    setSaving(true)
    const common = {
      name,
      label,
      color: color as (typeof PROFILE_COLORS)[number],
      defaultModel,
      ...(kind === 'ollama' ? { baseUrl: baseUrl.trim() } : {})
    }
    const key = apiKey.trim() ? { apiKey: apiKey.trim() } : {}
    const saved = editing
      ? await update({ id: profile.id, ...common, ...key })
      : await create({ kind, auth, ...common, ...key })
    setSaving(false)
    if (!saved) return
    close()
    if (!editing) onCreated?.(saved)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? t('Edit {kind} account', { kind: t(choice.title) }) : t('Add an account')}</DialogTitle>
        <DialogDescription>
          {kindDescription(kind)}
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
          <div className="grid max-h-[46vh] gap-3 overflow-y-auto pr-1" role="group" aria-label={t('Provider')}>
            {PROVIDER_FAMILIES.map((family) => (
              <section key={family.id} className="grid gap-1.5">
                <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t(family.label)}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {CHOICES.filter((c) => (family.kinds as readonly ProfileKind[]).includes(c.kind)).map((c) => {
                    const blocked = distribution && c.auth === 'subscription'
                    const taken = SINGLE_PROFILE_KINDS.includes(c.kind) && profiles.some((p) => p.kind === c.kind)
                    return (
                      <AuthOption
                        key={`${c.kind}:${c.auth}`}
                        active={c === choice}
                        disabled={blocked || taken}
                        icon={c.icon}
                        title={t(c.title)}
                        description={
                          blocked ? t('Not available in this build.') : taken ? t('You already have this account.') : t(c.description)
                        }
                        onClick={() => setChoice(c)}
                      />
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label={t('Name')}>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Claude perso')}
              maxLength={60}
            />
          </Field>
          <Field label={t('Label')}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('PERSO')} maxLength={12} />
          </Field>
        </div>

        <Field label={t('Color')}>
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
            label={editing ? t('Replace API key') : t('API key')}
            hint={t('Encrypted with the operating system\'s secure storage. It never leaves the main process.')}
          >
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={editing && profile.hasApiKey ? t('Stored, leave empty to keep it') : (choice.keyPlaceholder ?? t('API key'))}
              className="font-mono text-xs"
            />
          </Field>
        )}

        {kind === 'ollama' && (
          <Field label={t('Server URL')} hint={t('Where Ollama listens. Atelier talks to its OpenAI-compatible /v1 API.')}>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_OLLAMA_URL}
              className="font-mono text-xs"
              spellCheck={false}
            />
          </Field>
        )}

        <Field
          label={t('Default model')}
          hint={
            models.length
              ? undefined
              : isCliKind(kind)
                ? t('Empty uses the CLI’s default. Test the connection to list models.')
                : t('Empty picks the provider’s first chat model. Test the connection to list them.')
          }
        >
          <Input
            list="profile-models"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder={t('default')}
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
            {t('Cancel')}</Button>
          <Button type="submit" disabled={!canSave}>
            {editing ? t('Save') : t('Add account')}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
