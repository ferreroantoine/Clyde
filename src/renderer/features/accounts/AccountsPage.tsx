import { useCallback, useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import {
  Bot,
  CircleAlert,
  CircleCheck,
  Cpu,
  KeyRound,
  LoaderCircle,
  LogIn,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Gem,
  Orbit,
  Sparkles,
  SquareTerminal,
  Trash2,
  UserRound,
  type LucideIcon
} from 'lucide-react'
import { type Profile } from '@shared/profiles'
import type { CliStatus } from '@shared/cli'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/EmptyState'
import { ProfileDot } from '@/components/ProfileBadge'
import { invoke } from '@/lib/ipc'
import { useProfiles } from '@/stores/profiles'
import { useLayout } from '@/stores/layout'
import { ProfileDialog } from './ProfileDialog'
import { LoginDialog } from './LoginDialog'

function ConnectionLine({ profile }: { profile: Profile }) {
  const test = useProfiles((s) => s.tests[profile.id])
  if (!profile.usable) {
    return <p className="text-xs text-muted-foreground">{t('Disabled in this build: subscription logins are for personal use.')}</p>
  }
  if (test === 'testing') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" /> {' '}{t('Testing the connection…')}</p>
    )
  }
  if (!test) return <p className="text-xs text-muted-foreground">{t('Not tested yet.')}</p>
  const who = [test.email, test.subscriptionType].filter(Boolean).join(' · ')
  return (
    <div className="space-y-0.5 text-xs">
      <p className={test.ok ? 'flex items-center gap-1.5 text-success' : 'flex items-center gap-1.5 text-destructive'}>
        {test.ok ? <CircleCheck className="size-3.5" /> : <CircleAlert className="size-3.5" />}
        {test.status}
        {who && <span className="text-muted-foreground">· {who}</span>}
      </p>
      {test.detail && <p className="text-muted-foreground">{test.detail}</p>}
      {test.ok && test.models.length > 0 && (
        <p className="truncate text-muted-foreground" title={test.models.map((m) => m.displayName).join(', ')}>
          {t('Models: {list}', { list: test.models.map((m) => m.displayName).join(', ') })}
        </p>
      )}
    </div>
  )
}

function kindLine(profile: Profile): { icon: LucideIcon; text: string } {
  switch (profile.kind) {
    case 'claude-code':
      return profile.auth === 'subscription'
        ? { icon: UserRound, text: t('Claude Code · subscription') }
        : { icon: KeyRound, text: t('Claude Code · API key') }
    case 'codex':
      return { icon: SquareTerminal, text: t('Codex CLI · ChatGPT subscription') }
    case 'antigravity':
      return { icon: Orbit, text: t('Antigravity CLI · Google account') }
    case 'ollama':
      return { icon: Cpu, text: `Ollama · ${profile.baseUrl}` }
    case 'anthropic':
      return { icon: Sparkles, text: t('Anthropic API · API key') }
    case 'openai':
      return { icon: Bot, text: t('OpenAI API · API key') }
    case 'gemini':
      return { icon: Gem, text: t('Gemini API · API key') }
  }
}

function ProfileCard({
  profile,
  onEdit,
  onLogin,
  onDelete
}: {
  profile: Profile
  onEdit: () => void
  onLogin: () => void
  onDelete: () => void
}) {
  const test = useProfiles((s) => s.test)
  const testing = useProfiles((s) => s.tests[profile.id] === 'testing')
  const subscription = profile.auth === 'subscription'
  const { icon: KindIcon, text: kindText } = kindLine(profile)

  return (
    <article
      className="group relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 pl-5 shadow-xs transition-shadow hover:shadow-sm"
      aria-label={`Account ${profile.name}`}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: profile.color }} />
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <ProfileDot color={profile.color} className="size-2.5" />
            <h3 className="truncate text-sm font-semibold">{profile.name}</h3>
            {profile.label && (
              <span
                className="shrink-0 rounded px-1.5 text-[10px] leading-4 font-semibold tracking-wide uppercase"
                style={{ color: profile.color, backgroundColor: `color-mix(in oklab, ${profile.color} 14%, transparent)` }}
              >
                {profile.label}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <KindIcon className="size-3.5" />
            <span className="truncate">{kindText}</span>
            {profile.personalUse && (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-medium">
                {t('Personal use')}</Badge>
            )}
            {profile.defaultModel && <span className="font-mono">· {profile.defaultModel}</span>}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={t('Actions for {name}', { name: profile.name })}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> {' '}{t('Edit')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> {' '}{t('Delete')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <ConnectionLine profile={profile} />

      <footer className="flex gap-2">
        {subscription && (
          <Button size="xs" variant="outline" disabled={!profile.usable} onClick={onLogin}>
            <LogIn /> {' '}{t('Sign in')}</Button>
        )}
        <Button size="xs" variant="outline" disabled={!profile.usable || testing} onClick={() => void test(profile.id)}>
          <RefreshCw className={testing ? 'animate-spin' : undefined} /> {' '}{t('Test connection')}</Button>
      </footer>
    </article>
  )
}

const CLI_NAMES: Record<CliStatus['kind'], string> = { 'claude-code': 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' }

/** Which coding CLIs Atelier found, with their versions. */
function CliLine() {
  const [status, setStatus] = useState<CliStatus[] | null>(null)
  const [checking, setChecking] = useState(true)
  const fetchStatus = useCallback((refresh: boolean) => {
    invoke('cli:status', { refresh })
      .then(setStatus)
      .catch(() => setStatus([]))
      .finally(() => setChecking(false))
  }, [])
  const load = (refresh: boolean) => {
    setChecking(true)
    fetchStatus(refresh)
  }
  useEffect(() => fetchStatus(false), [fetchStatus])
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label={t('Coding CLIs')}>
      {(status ?? []).map((c) => (
        <span key={c.kind} className="flex items-center gap-1.5" title={c.detail ?? c.path ?? undefined}>
          {c.installed ? <CircleCheck className="size-3.5 text-success" /> : <CircleAlert className="size-3.5 text-warning" />}
          <span className="font-medium text-foreground">{CLI_NAMES[c.kind]}</span>
          {c.installed ? (c.version ?? t('version unknown')) : t('not found')}
          {c.bundled && ` · ${t('bundled')}`}
        </span>
      ))}
      <Button size="xs" variant="ghost" disabled={checking} onClick={() => load(true)} aria-label={t('Check CLIs again')}>
        <RefreshCw className={checking ? 'animate-spin' : undefined} /> {status ? t('Check again') : t('Checking CLIs…')}
      </Button>
    </div>
  )
}

/** `embedded` drops the page frame and title, for Settings. */
export function AccountsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const profiles = useProfiles((s) => s.profiles)
  const loaded = useProfiles((s) => s.loaded)
  const remove = useProfiles((s) => s.remove)
  const test = useProfiles((s) => s.test)
  const [distribution, setDistribution] = useState(false)
  const [editing, setEditing] = useState<Profile | 'new' | null>(null)
  const intent = useLayout((s) => s.intent)
  const clearIntent = useLayout((s) => s.clearIntent)
  const [loginFor, setLoginFor] = useState<Profile | null>(null)
  const [deleting, setDeleting] = useState<Profile | null>(null)
  const closeLogin = useCallback(() => setLoginFor(null), [])

  useEffect(() => {
    void invoke('app:getInfo').then((info) => setDistribution(info.distribution))
  }, [])

  const onCreated = (profile: Profile) => {
    if (profile.auth === 'subscription') setLoginFor(profile)
    else void test(profile.id)
  }

  return (
    <div className={embedded ? undefined : 'h-full overflow-y-auto'}>
      <div className={embedded ? 'pb-2' : 'mx-auto max-w-4xl px-8 py-10'}>
        <div className="flex items-end justify-between gap-4">
          <div>
            {!embedded && <h1 className="text-lg font-semibold tracking-tight">{t('Accounts')}</h1>}
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Each account has its own color and label, shown wherever it works. Atelier never switches accounts on its own.')}</p>
          </div>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> {' '}{t('Add account')}</Button>
        </div>
        <CliLine />

        {loaded && profiles.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed py-14">
            <EmptyState
              icon={KeyRound}
              title={t('No account yet')}
              description={t('Add a Claude, ChatGPT or Google subscription, an API key for Anthropic, OpenAI or Gemini, or a local Ollama.')}
              action={
                <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
                  <Plus /> {' '}{t('Add account')}</Button>
              }
            />
          </div>
        ) : (
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {profiles.map((p) => (
              <ProfileCard
                key={p.id}
                profile={p}
                onEdit={() => setEditing(p)}
                onLogin={() => setLoginFor(p)}
                onDelete={() => setDeleting(p)}
              />
            ))}
          </div>
        )}

        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
          {t(
            'Subscription accounts sign in through each CLI’s own login (Claude Code, Codex, Antigravity) and are meant for personal use: Atelier never sees the credentials, and Anthropic does not allow third-party products to offer claude.ai login without approval.'
          )}
          {distribution && ` ${t('This build only allows API key accounts.')}`}
        </p>
      </div>

      <ProfileDialog
        open={editing !== null || intent === 'new-account'}
        onOpenChange={(open) => {
          if (open) return
          setEditing(null)
          if (intent === 'new-account') clearIntent()
        }}
        {...(editing && editing !== 'new' ? { profile: editing } : {})}
        distribution={distribution}
        onCreated={onCreated}
      />
      <LoginDialog profile={loginFor} onClose={closeLogin} />
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('Delete {name}?', { name: deleting?.name ?? '' })}</DialogTitle>
            <DialogDescription>
              {t('This removes the account from Atelier, its stored key, and its Claude Code folder, including the sign-in.')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('Cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) void remove(deleting.id)
                setDeleting(null)
              }}
            >
              {t('Delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
