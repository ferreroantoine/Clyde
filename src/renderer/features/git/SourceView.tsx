import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  CloudUpload,
  Download,
  Ellipsis,
  FileText,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  History,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  type LucideIcon
} from 'lucide-react'
import { t, tk, tn } from '@shared/i18n'
import type { FileSession, GitBranch as Branch, GitCheckpoint, GitFileChange } from '@shared/git'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useGit } from '@/stores/git'
import { useLayout } from '@/stores/layout'
import { notify } from '@/stores/notifications'
import { profileById, useProfiles } from '@/stores/profiles'
import { IconButton } from '@/components/IconButton'
import { EmptyState } from '@/components/EmptyState'
import { askText } from '@/components/PromptDialog'
import { Skeleton } from '@/components/Skeleton'
import { ProfileDot } from '@/components/ProfileBadge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { FileIcon } from '@/features/explorer/FileIcon'
import { HistoryPanel } from './HistoryPanel'
import {
  checkout,
  copyText,
  createBranch,
  dateTime,
  dirOf,
  discard,
  nameOf,
  openFile,
  openSession,
  resolveConflicts,
  reviewChanges,
  STATE_COLOR,
  STATE_LABEL,
  STATE_LETTER
} from './actions'

/** Rows drawn per list; the rest is counted. */
const MAX_ROWS = 400

type Tab = 'changes' | 'history' | 'branches'

const OPERATION_LABEL = {
  merge: tk('Merge in progress'),
  rebase: tk('Rebase in progress'),
  'cherry-pick': tk('Cherry-pick in progress'),
  revert: tk('Revert in progress')
} as const

export function SourceView() {
  const status = useGit((s) => s.status)
  const busy = useGit((s) => s.busy)
  const [tab, setTab] = useState<Tab>('changes')

  if (!status) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="w-40" />
        <Skeleton className="w-28" />
      </div>
    )
  }
  if (!status.isRepo) {
    return (
      <EmptyState
        icon={GitBranch}
        title={t('No git repository')}
        description={t('The open folder is not in a git repository.')}
        action={
          <Button size="sm" disabled={!!busy} onClick={() => void useGit.getState().run('init', t('Could not create the repository'), () => invoke('git:init'))}>
            {t('Initialize repository')}
          </Button>
        }
      />
    )
  }
  const count = status.staged.length + status.unstaged.length + status.untracked.length + status.conflicts.length
  const tabs: Array<[Tab, string, number]> = [
    ['changes', t('Changes'), count],
    ['history', t('History'), 0],
    ['branches', t('Branches'), 0]
  ]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <BranchBar />
      <div className="flex shrink-0 items-center overflow-x-auto border-b px-1.5 py-1 [scrollbar-width:none]">
        {tabs.map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            data-git-tab={id}
            className={cn('press flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap transition-colors', tab === id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {label}
            {n > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{n}</span>}
          </button>
        ))}
      </div>
      {tab === 'changes' && <ChangesPanel />}
      {tab === 'history' && <HistoryPanel />}
      {tab === 'branches' && <BranchesPanel />}
    </div>
  )
}

// Branch and sync

function BranchBar() {
  const status = useGit((s) => s.status)
  const branches = useGit((s) => s.branches)
  const busy = useGit((s) => s.busy)
  const run = useGit((s) => s.run)
  const report = useGit((s) => s.report)
  if (!status) return null
  const label = status.branch ?? (status.head ? t('Detached at {hash}', { hash: status.head.slice(0, 7) }) : t('No commit yet'))
  const local = branches.filter((b) => !b.remote && !b.current)

  const pull = async () => report(await run('pull', t('Could not pull'), () => invoke('git:pull')), t('Pulled'))
  const push = async () => {
    if (await run('push', t('Could not push'), () => invoke('git:push'))) notify.success(status.upstream ? t('Pushed') : t('Branch published'))
  }
  const sync = async () => {
    if (status.behind > 0) await pull()
    if (status.ahead > 0) await push()
  }
  const fetch = () => void run('fetch', t('Could not fetch'), () => invoke('git:fetch'))

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="press flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent" title={t('Switch branch')}>
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{label}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 w-64 overflow-y-auto">
          <DropdownMenuItem onSelect={() => void createBranch()}>
            <GitBranchPlus />
            {t('New branch…')}
          </DropdownMenuItem>
          {local.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">{t('Switch to')}</DropdownMenuLabel>
              {local.map((b) => (
                <DropdownMenuItem key={b.name} onSelect={() => void checkout(b.name)}>
                  <GitBranch />
                  <span className="truncate">{b.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {busy && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label={t('Working…')} />}
      {status.branch && !status.upstream ? (
        <IconButton icon={CloudUpload} label={t('Publish branch')} disabled={!!busy} onClick={() => void push()} />
      ) : (
        status.upstream && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void (status.ahead || status.behind ? sync() : fetch())}
                className="press flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                {status.ahead || status.behind ? (
                  <>
                    <ArrowDown className="size-3" />
                    {status.behind}
                    <ArrowUp className="size-3" />
                    {status.ahead}
                  </>
                ) : (
                  <RefreshCw className="size-3" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {status.ahead || status.behind
                ? t('Sync with {upstream}: pull {behind}, push {ahead}', { upstream: status.upstream, behind: status.behind, ahead: status.ahead })
                : t('Fetch from the remotes')}
            </TooltipContent>
          </Tooltip>
        )
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={Ellipsis} label={t('More git actions')} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem disabled={!!busy} onSelect={fetch}>
            <RefreshCw />
            {t('Fetch')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!!busy || !status.upstream} onSelect={() => void pull()}>
            <Download />
            {t('Pull')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!!busy || !status.branch} onSelect={() => void push()}>
            <Upload />
            {status.upstream ? t('Push') : t('Publish branch')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!!busy} onSelect={() => void stash()}>
            <History />
            {t('Stash changes…')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={reviewChanges}>
            <Bot />
            {t('Review my changes with the agent')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void useGit.getState().refresh()}>
            <RefreshCw />
            {t('Refresh')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

async function stash(): Promise<void> {
  const message = await askText({ title: t('Stash changes'), label: t('Stash message'), placeholder: t('What these changes are (optional)'), confirm: t('Stash'), optional: true })
  if (message === null) return
  await useGit.getState().run('stash', t('Could not stash'), () => invoke('git:stash', { message: message.trim(), untracked: true }))
}

// Changes

function ChangesPanel() {
  const status = useGit((s) => s.status)
  if (!status) return null
  const changes = [...status.unstaged, ...status.untracked].sort((a, b) => a.path.localeCompare(b.path))
  const empty = !changes.length && !status.staged.length && !status.conflicts.length
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      {status.operation && <OperationBanner />}
      <CommitBox />
      {status.truncated && <p className="px-3 py-1 text-[11px] text-warning">{t('Too many changes: only part of them is listed.')}</p>}
      {status.conflicts.length > 0 && (
        <Section
          title={t('Conflicts')}
          count={status.conflicts.length}
          actions={<IconButton icon={Bot} label={t('Resolve with the agent')} onClick={() => resolveConflicts(status.conflicts.map((c) => c.path))} />}
        >
          {status.conflicts.map((c) => (
            <ChangeRow key={c.path} change={c} kind="conflict" />
          ))}
        </Section>
      )}
      {status.staged.length > 0 && (
        <Section
          title={t('Staged changes')}
          count={status.staged.length}
          actions={<IconButton icon={Minus} label={t('Unstage all')} onClick={() => void useGit.getState().run('unstage', t('Could not unstage'), () => invoke('git:unstageAll'))} />}
        >
          {status.staged.slice(0, MAX_ROWS).map((c) => (
            <ChangeRow key={c.path} change={c} kind="staged" />
          ))}
          <More count={status.staged.length} />
        </Section>
      )}
      {changes.length > 0 && (
        <Section
          title={t('Changes')}
          count={changes.length}
          actions={
            <>
              <IconButton icon={Undo2} label={t('Discard all changes')} onClick={() => void discard(changes.map((c) => c.path), status.untracked.length)} />
              <IconButton icon={Plus} label={t('Stage all')} onClick={() => void useGit.getState().run('stage', t('Could not stage'), () => invoke('git:stageAll'))} />
            </>
          }
        >
          {changes.slice(0, MAX_ROWS).map((c) => (
            <ChangeRow key={`${c.path}:${c.state}`} change={c} kind="unstaged" />
          ))}
          <More count={changes.length} />
        </Section>
      )}
      {empty && <p className="px-3 py-3 text-xs text-muted-foreground">{t('No changes. The working tree matches the last commit.')}</p>}
      <StashSection />
      <CheckpointSection />
    </div>
  )
}

function More({ count }: { count: number }) {
  if (count <= MAX_ROWS) return null
  return <p className="px-3 py-1 text-[11px] text-muted-foreground">{t('…and {count} more', { count: count - MAX_ROWS })}</p>
}

function OperationBanner() {
  const status = useGit((s) => s.status)
  const run = useGit((s) => s.run)
  const report = useGit((s) => s.report)
  if (!status?.operation) return null
  const conflicts = status.conflicts.map((c) => c.path)
  return (
    <div className="m-2 flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        <GitMerge className="size-3.5 text-warning" />
        {t(OPERATION_LABEL[status.operation])}
      </div>
      <p className="text-muted-foreground">
        {conflicts.length
          ? tn('{count} file has conflicts. Resolve it, stage it, then continue.', '{count} files have conflicts. Resolve them, stage them, then continue.', conflicts.length)
          : t('No conflicts left. Continue to finish, or abort to go back.')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {conflicts.length > 0 && (
          <Button size="xs" variant="outline" onClick={() => resolveConflicts(conflicts)}>
            <Bot />
            {t('Resolve with the agent')}
          </Button>
        )}
        {conflicts.length === 0 && (
          <Button size="xs" onClick={async () => report(await run('continue', t('Could not continue'), () => invoke('git:continue')), t('Done'))}>
            {t('Continue')}
          </Button>
        )}
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            if (window.confirm(t('Abort and put everything back as it was before?'))) void run('abort', t('Could not abort'), () => invoke('git:abort'))
          }}
        >
          {t('Abort')}
        </Button>
      </div>
    </div>
  )
}

function CommitBox() {
  const message = useGit((s) => s.message)
  const amend = useGit((s) => s.amend)
  const busy = useGit((s) => s.busy)
  const generating = useGit((s) => s.generating)
  const status = useGit((s) => s.status)
  const git = useGit.getState()
  const staged = status?.staged.length ?? 0
  const label = amend ? t('Amend last commit') : staged ? tn('Commit {count} file', 'Commit {count} files', staged) : t('Commit')

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b p-2">
      <div className="relative">
        <textarea
          value={message}
          onChange={(e) => git.setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void git.commit()
            }
          }}
          rows={Math.min(8, Math.max(2, message.split('\n').length))}
          placeholder={status?.branch ? t('Message (Ctrl+Enter to commit on {branch})', { branch: status.branch }) : t('Commit message')}
          aria-label={t('Commit message')}
          spellCheck
          className="w-full resize-none rounded-md border bg-background px-2 py-1.5 pr-7 text-xs outline-none focus-visible:border-ring"
        />
        <IconButton
          icon={generating ? LoaderCircle : Sparkles}
          label={t('Write the message with AI')}
          disabled={generating}
          onClick={() => void git.generateMessage()}
          className={cn('absolute top-1 right-1', generating && '[&_svg]:animate-spin')}
        />
      </div>
      <div className="flex">
        <Button size="xs" className="flex-1 rounded-r-none" disabled={!!busy || !message.trim()} onClick={() => void git.commit()}>
          {busy === 'commit' ? <LoaderCircle className="animate-spin" /> : <Check />}
          {label}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="xs" className="rounded-l-none border-l border-primary-foreground/20 px-1" disabled={!!busy} aria-label={t('More commit options')}>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={!message.trim()} onSelect={() => void git.commit(true)}>
              <Upload />
              {t('Commit and push')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={amend} onCheckedChange={(v) => void git.setAmend(v === true)}>
              {t('Amend the last commit')}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function Section({ title, count, actions, children, defaultOpen = true }: { title: string; count?: number; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="flex flex-col">
      <div className="group flex h-7 shrink-0 items-center gap-1 pr-1.5 pl-1">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums">{count}</span>}
        </button>
        {actions && <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">{actions}</div>}
      </div>
      {open && children}
    </section>
  )
}

function SessionsMark({ sessions }: { sessions: FileSession[] }) {
  const profiles = useProfiles((s) => s.profiles)
  const first = sessions[0]
  if (!first) return null
  const color = profileById(profiles, first.profileId)?.color
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            openSession(first.sessionId)
          }}
          className="flex shrink-0 items-center"
          aria-label={t('Changed by an agent')}
        >
          <Bot className="size-3.5" style={color ? { color } : undefined} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-72">
        <p className="mb-1 font-medium">{tn('Written by {count} agent session', 'Written by {count} agent sessions', sessions.length)}</p>
        {sessions.slice(0, 4).map((s) => (
          <p key={s.sessionId} className="truncate">
            {dateTime(s.at)} · {s.title ?? t('Untitled session')}
          </p>
        ))}
        <p className="mt-1 opacity-70">{t('Click to open the latest one.')}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function ChangeRow({ change, kind }: { change: GitFileChange; kind: 'staged' | 'unstaged' | 'conflict' }) {
  const view = useGit((s) => s.view)
  const sessions = useGit((s) => s.fileSessions[change.path])
  const git = useGit.getState()
  const selected = view?.kind === 'change' && view.path === change.path && view.mode === (kind === 'staged' ? 'staged' : 'unstaged')
  const untracked = change.state === 'untracked'

  const openDiff = () => {
    if (kind === 'conflict') return openFile(change.path)
    git.show({ kind: 'change', path: change.path, mode: kind === 'staged' ? 'staged' : 'unstaged', oldPath: change.oldPath })
  }
  const stage = () => void git.run('stage', t('Could not stage'), () => invoke('git:stage', { paths: [change.path] }))
  const unstage = () => void git.run('unstage', t('Could not unstage'), () => invoke('git:unstage', { paths: [change.path] }))
  const remove = () => void discard([change.path], untracked ? 1 : 0)

  const actions: Array<[LucideIcon, string, () => void]> =
    kind === 'staged'
      ? [
          [FileText, t('Open file'), () => openFile(change.path)],
          [Minus, t('Unstage'), unstage]
        ]
      : kind === 'conflict'
        ? [
            [Bot, t('Resolve with the agent'), () => resolveConflicts([change.path])],
            [Plus, t('Mark as resolved'), stage]
          ]
        : [
            [FileText, t('Open file'), () => openFile(change.path)],
            [Undo2, untracked ? t('Delete') : t('Discard changes'), remove],
            [Plus, t('Stage'), stage]
          ]

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={openDiff}
          onKeyDown={(e) => e.key === 'Enter' && openDiff()}
          title={`${change.oldPath ? `${change.oldPath} → ` : ''}${change.path} · ${t(STATE_LABEL[change.state])}`}
          data-git-path={change.path}
          className={cn('group flex h-6 cursor-default items-center gap-1.5 pr-1.5 pl-5 text-[13px] outline-none hover:bg-accent/70 focus-visible:bg-accent', selected && 'bg-accent')}
        >
          <FileIcon name={nameOf(change.path)} className="size-3.5" />
          <span className={cn('truncate', change.state === 'deleted' && 'line-through opacity-70')}>{nameOf(change.path)}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{dirOf(change.path)}</span>
          <span className="hidden items-center gap-0.5 group-focus-within:flex group-hover:flex">
            {actions.map(([icon, label, action]) => (
              <IconButton
                key={label}
                icon={icon}
                label={label}
                className="size-5"
                onClick={(e) => {
                  e.stopPropagation()
                  action()
                }}
              />
            ))}
          </span>
          {sessions && <SessionsMark sessions={sessions} />}
          <span className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', STATE_COLOR[change.state])}>{STATE_LETTER[change.state]}</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {kind !== 'conflict' && (
          <ContextMenuItem onSelect={openDiff}>
            <GitMerge />
            {t('Open changes')}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => openFile(change.path)}>
          <FileText />
          {t('Open file')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {actions
          .filter(([icon]) => icon !== FileText)
          .map(([icon, label, action]) => {
            const Icon = icon
            return (
              <ContextMenuItem key={label} onSelect={action} variant={icon === Undo2 ? 'destructive' : 'default'}>
                <Icon />
                {label}
              </ContextMenuItem>
            )
          })}
        {sessions && sessions.length > 0 && (
          <>
            <ContextMenuSeparator />
            {sessions.slice(0, 5).map((s) => (
              <ContextMenuItem key={s.sessionId} onSelect={() => openSession(s.sessionId)}>
                <Bot />
                <span className="truncate">{t('Open session: {title}', { title: s.title ?? t('Untitled session') })}</span>
              </ContextMenuItem>
            ))}
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyText(change.path)}>
          <ClipboardCopy />
          {t('Copy relative path')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// Stashes

function StashSection() {
  const stashes = useGit((s) => s.stashes)
  const run = useGit((s) => s.run)
  const report = useGit((s) => s.report)
  if (!stashes.length) return null
  const apply = async (index: number, pop: boolean) => report(await run('stash', t('Could not apply the stash'), () => invoke('git:stashApply', { index, pop })), pop ? t('Stash applied and dropped') : t('Stash applied'))
  return (
    <Section title={t('Stashes')} count={stashes.length} defaultOpen={false}>
      {stashes.map((s) => (
        <div key={s.index} className="group flex h-6 items-center gap-1.5 pr-1.5 pl-5 text-[13px] hover:bg-accent/70" title={`stash@{${s.index}} · ${dateTime(s.date)}`}>
          <History className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{s.message || t('Untitled stash')}</span>
          <span className="text-[11px] text-muted-foreground group-hover:hidden">{dateTime(s.date)}</span>
          <span className="hidden items-center gap-0.5 group-hover:flex">
            <IconButton icon={Download} label={t('Apply')} className="size-5" onClick={() => void apply(s.index, false)} />
            <IconButton icon={ArrowUp} label={t('Apply and drop')} className="size-5" onClick={() => void apply(s.index, true)} />
            <IconButton
              icon={Trash2}
              label={t('Drop')}
              className="size-5"
              onClick={() => {
                if (window.confirm(t('Drop this stash? Its changes are lost.'))) void run('stash', t('Could not drop the stash'), () => invoke('git:stashDrop', { index: s.index }))
              }}
            />
          </span>
        </div>
      ))}
    </Section>
  )
}

// Restore points

function CheckpointSection() {
  const checkpoints = useGit((s) => s.checkpoints)
  if (!checkpoints.length) return null
  return (
    <Section title={t('Restore points')} count={checkpoints.length} defaultOpen={false}>
      <p className="px-5 pb-1 text-[11px] text-muted-foreground">{t('The files as they were before each agent session.')}</p>
      {checkpoints.map((c) => (
        <CheckpointRow key={c.sessionId} checkpoint={c} />
      ))}
    </Section>
  )
}

function CheckpointRow({ checkpoint }: { checkpoint: GitCheckpoint }) {
  const [open, setOpen] = useState(false)
  const [changes, setChanges] = useState<GitFileChange[] | null>(null)
  const status = useGit((s) => s.status)
  const profile = profileById(
    useProfiles((s) => s.profiles),
    checkpoint.profileId
  )
  useEffect(() => {
    if (!open) return
    let live = true
    invoke('git:checkpointChanges', { sessionId: checkpoint.sessionId })
      .then((list) => live && setChanges(list))
      .catch(() => live && setChanges([]))
    return () => {
      live = false
    }
  }, [open, checkpoint.sessionId, status])

  const restore = async () => {
    const count = changes?.length ?? 0
    if (!window.confirm(tn('Put {count} file back as it was before this session? Changes made since (by any agent or by you) are lost; new files go to the Recycle Bin.', 'Put {count} files back as they were before this session? Changes made since (by any agent or by you) are lost; new files go to the Recycle Bin.', count))) return
    const restored = await useGit.getState().run('restore', t('Could not restore'), () => invoke('git:restoreCheckpoint', { sessionId: checkpoint.sessionId }))
    if (restored !== undefined) notify.success(tn('{count} file restored', '{count} files restored', restored))
  }

  return (
    <div className="flex flex-col">
      <button type="button" onClick={() => setOpen(!open)} className="flex h-6 items-center gap-1.5 pr-1.5 pl-5 text-left text-[13px] hover:bg-accent/70">
        <RotateCcw className="size-3.5 shrink-0 text-muted-foreground" />
        {profile && <ProfileDot color={profile.color} />}
        <span className="min-w-0 flex-1 truncate">{checkpoint.title ?? t('Untitled session')}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{dateTime(checkpoint.createdAt)}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 py-1 pr-2 pl-10 text-xs">
          {changes === null ? (
            <Skeleton className="w-32" />
          ) : changes.length === 0 ? (
            <p className="text-muted-foreground">{t('Nothing changed since.')}</p>
          ) : (
            <>
              <p className="text-muted-foreground">{tn('{count} file differs since.', '{count} files differ since.', changes.length)}</p>
              <ul className="max-h-32 overflow-y-auto">
                {changes.slice(0, 50).map((c) => (
                  <li key={c.path} className="flex items-center gap-1.5 truncate">
                    <span className={cn('w-3 font-mono text-[11px] font-semibold', STATE_COLOR[c.state])}>{STATE_LETTER[c.state === 'added' ? 'untracked' : c.state]}</span>
                    <span className="truncate">{c.path}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant="outline" disabled={!changes?.length} onClick={() => void restore()}>
              <RotateCcw />
              {t('Undo these changes')}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => openSession(checkpoint.sessionId)}>
              <Bot />
              {t('Open session')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// Branches

function BranchesPanel() {
  const branches = useGit((s) => s.branches)
  const local = branches.filter((b) => !b.remote)
  const remote = branches.filter((b) => b.remote)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div className="p-2">
        <Button size="xs" variant="outline" className="w-full" onClick={() => void createBranch()}>
          <GitBranchPlus />
          {t('New branch…')}
        </Button>
      </div>
      <Section title={t('Local')} count={local.length}>
        {local.map((b) => (
          <BranchRow key={b.name} branch={b} />
        ))}
      </Section>
      {remote.length > 0 && (
        <Section title={t('Remote')} count={remote.length}>
          {remote.map((b) => (
            <BranchRow key={b.name} branch={b} />
          ))}
        </Section>
      )}
    </div>
  )
}

function BranchRow({ branch }: { branch: Branch }) {
  const status = useGit((s) => s.status)
  const run = useGit((s) => s.run)
  const report = useGit((s) => s.report)
  const current = status?.branch ?? null
  const merge = async () => {
    if (!current || !window.confirm(t('Merge {branch} into {current}?', { branch: branch.name, current }))) return
    report(await run('merge', t('Could not merge'), () => invoke('git:merge', { ref: branch.name })), t('Merged {branch}', { branch: branch.name }))
  }
  const remove = async () => {
    if (!window.confirm(branch.remote ? t('Delete the remote branch {branch}? This changes the remote for everyone.', { branch: branch.name }) : t('Delete the branch {branch}?', { branch: branch.name }))) return
    try {
      await invoke('git:deleteBranch', { name: branch.name, remote: branch.remote, force: false })
      void useGit.getState().refresh()
    } catch (err) {
      // Not merged: deleting it loses commits; ask again.
      if (!branch.remote && window.confirm(t('{branch} is not fully merged. Delete it anyway? Its commits that are on no other branch are lost.', { branch: branch.name }))) {
        await run('branch', t('Could not delete the branch'), () => invoke('git:deleteBranch', { name: branch.name, remote: false, force: true }))
      } else if (branch.remote) {
        notify.error(t('Could not delete the branch'), err)
      }
    }
  }
  const actions: Array<[LucideIcon, string, () => void, boolean?]> = [
    [GitBranch, t('Check out'), () => void checkout(branch.name)],
    [GitMerge, t('Merge into the current branch'), () => void merge()],
    [GitBranchPlus, t('New branch from here…'), () => void createBranch(branch.name)],
    [Trash2, t('Delete'), () => void remove(), true]
  ]
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onDoubleClick={() => !branch.current && void checkout(branch.name)}
          title={`${branch.name} · ${branch.short} · ${dateTime(branch.date)}${branch.upstream ? ` · ${branch.upstream}` : ''}`}
          className="group flex h-6 cursor-default items-center gap-1.5 pr-1.5 pl-5 text-[13px] hover:bg-accent/70"
        >
          {branch.current ? <Check className="size-3.5 shrink-0 text-primary" /> : <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className={cn('min-w-0 flex-1 truncate', branch.current && 'font-medium')}>{branch.name}</span>
          {branch.gone && <span className="text-[10px] text-warning">{t('gone')}</span>}
          {(branch.ahead > 0 || branch.behind > 0) && (
            <span className="flex items-center text-[11px] text-muted-foreground tabular-nums">
              {branch.behind > 0 && (
                <>
                  <ArrowDown className="size-3" />
                  {branch.behind}
                </>
              )}
              {branch.ahead > 0 && (
                <>
                  <ArrowUp className="size-3" />
                  {branch.ahead}
                </>
              )}
            </span>
          )}
          {!branch.current && (
            <span className="hidden items-center gap-0.5 group-hover:flex">
              {actions.slice(0, 2).map(([icon, label, action]) => (
                <IconButton key={label} icon={icon} label={label} className="size-5" onClick={action} />
              ))}
            </span>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {actions
          .filter((_, i) => !branch.current || i === 2)
          .map(([Icon, label, action, destructive]) => (
            <ContextMenuItem key={label} onSelect={action} variant={destructive ? 'destructive' : 'default'}>
              <Icon />
              {label}
            </ContextMenuItem>
          ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyText(branch.name)}>
          <ClipboardCopy />
          {t('Copy name')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Opens the Source view in the sidebar. */
export function showSource(): void {
  useLayout.getState().showSidebarTab('git')
}
