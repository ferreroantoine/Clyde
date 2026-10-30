import { useEffect, useRef, useState } from 'react'
import { intlLocale, t, tk } from '@shared/i18n'
import { ArrowLeftRight, CircleAlert, FoldVertical, Gauge, History, Play, RotateCcw, StepForward } from 'lucide-react'
import { PERMISSION_LEVEL_LABELS, type AgentStatus } from '@shared/agent'
import { EFFORT_LABELS, kindLabel } from '@shared/profiles'
import { Button } from '@/components/ui/button'
import { ProfileBadge } from '@/components/ProfileBadge'
import type { SessionView, TranscriptItem } from '@/lib/transcript'
import { ENDED_STATUSES, useAgents } from '@/stores/agents'
import { profileById, useProfiles } from '@/stores/profiles'
import { cn } from '@/lib/utils'
import { RichText } from './RichText'
import { SessionLimitLine } from '@/features/limits/LimitGauge'
import { useLimits } from '@/stores/limits'
import { ToolCard } from './ToolCard'
import { ActionGroup, ThinkingBlock } from './Activity'
import { groupRows } from '@/lib/activity'
import { Composer } from './Composer'
import { Appear } from '@/components/Appear'
import { useSettings } from '@/stores/settings'
import { LimitBar, SwitchDialog } from './SwitchAccount'

export const STATUS_LABELS: Record<AgentStatus, string> = {
  starting: tk('Starting'),
  idle: tk('Ready'),
  running: tk('Working'),
  'awaiting-approval': tk('Needs approval'),
  stopped: tk('Stopped'),
  error: tk('Ended with an error'),
  interrupted: tk('Interrupted')
}

export function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <span
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        status === 'running' && 'animate-pulse bg-primary',
        status === 'awaiting-approval' && 'bg-warning',
        status === 'idle' && 'bg-success',
        status === 'starting' && 'animate-pulse bg-muted-foreground',
        (status === 'stopped' || status === 'error') && 'bg-muted-foreground/50'
      )}
    />
  )
}

export const usd = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`)
export const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

/** `subscription` hides per-turn prices: on a plan, Claude Code's cost is not what you pay. */
export function Item({
  item,
  cwd,
  ended,
  sessionId,
  subscription = false,
  streaming = false
}: {
  item: TranscriptItem
  cwd: string
  ended: boolean
  sessionId: string
  subscription?: boolean
  /** The last text of a running turn: shows a typing caret. */
  streaming?: boolean
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-6 rounded-lg bg-primary/10 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
          {item.text}
        </div>
      )
    case 'text':
      return <RichText text={item.text} streaming={streaming} />
    case 'thinking':
      return <ThinkingBlock text={item.text} live={!item.final && !ended} />
    case 'tool':
      return <ToolCard tool={item} cwd={cwd} ended={ended} sessionId={sessionId} />
    case 'turn':
      return (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-turn={item.subtype}>
          {item.isError && <CircleAlert className="size-3 text-destructive" />}
          {item.isError ? item.errors[0] ?? t('Turn ended: {reason}', { reason: item.subtype.replace(/_/g, ' ') }) : t('Done')}
          <span>
            · {(item.durationMs / 1000).toFixed(1)}s · {t('{input} in / {output} out', { input: tokens(item.inputTokens), output: tokens(item.outputTokens) })}
            {item.costUsd !== null && !subscription && ` · ${usd(item.costUsd)}`}
          </span>
        </p>
      )
    case 'error':
      return (
        <p className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {item.message}
        </p>
      )
    case 'note':
      return <p className="text-center text-[11px] text-muted-foreground italic">{item.text}</p>
  }
}

export function itemKey(item: TranscriptItem): string {
  switch (item.kind) {
    case 'user':
    case 'turn':
    case 'error':
    case 'note':
      return `${item.kind}-${item.id}`
    case 'text':
      return `text-${item.key}`
    case 'thinking':
      return `thinking-${item.key}`
    case 'tool':
      return `tool-${item.toolUseId}`
  }
}

/**
 * The transcript as the user reads it: messages, the agent's reasoning between its actions,
 * tool cards, and runs of actions folded under a summary.
 */
export function TranscriptRows({ view, live = true, subscription = false }: { view: SessionView; live?: boolean; subscription?: boolean }) {
  const ended = !live || ENDED_STATUSES.has(view.info.status)
  const last = view.items.at(-1)
  return groupRows(view.items).map((row) =>
    row.kind === 'group' ? (
      <Appear key={row.id}>
        <ActionGroup tools={row.tools} cwd={view.info.cwd} ended={ended} sessionId={view.info.id} />
      </Appear>
    ) : (
      <Appear key={itemKey(row.item)}>
        <Item
          item={row.item}
          cwd={view.info.cwd}
          ended={ended}
          sessionId={view.info.id}
          subscription={subscription}
          streaming={live && row.item === last && row.item.kind === 'text' && !row.item.final && view.info.status === 'running'}
        />
      </Appear>
    )
  )
}

function SessionComposer({ view }: { view: SessionView }) {
  const send = useAgents((s) => s.send)
  const interrupt = useAgents((s) => s.interrupt)
  const status = view.info.status
  const ended = ENDED_STATUSES.has(status)
  // An ended session that can come back takes messages: sending resumes it first.
  const closed = ended && !view.resumable
  const busy = status === 'running' || status === 'awaiting-approval'
  return (
    <Composer
      draftId={view.info.id}
      locked={closed}
      canSend={status !== 'starting'}
      busy={busy}
      onSubmit={send}
      onInterrupt={() => void interrupt()}
      placeholder={
        closed
          ? t('This session has ended')
          : ended
            ? t('Write to resume this session… (Enter to send)')
            : busy
              ? t('Queue a follow-up…')
              : t('Ask the agent… (Enter to send)')
      }
    />
  )
}

/** An ended session that can come back: why it ended, and the way to resume it. */
function ResumeBar({ view }: { view: SessionView }) {
  const resume = useAgents((s) => s.resume)
  const resuming = useAgents((s) => s.resuming === view.info.id)
  const status = view.info.status
  if (!ENDED_STATUSES.has(status) || !view.resumable) return null
  const interrupted = status === 'interrupted'
  return (
    <div
      className={cn('flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[11px]', interrupted ? 'bg-warning/10' : 'text-muted-foreground')}
      data-testid="resume-bar"
    >
      <History className="size-3.5 shrink-0" />
      {/* Narrow panels put the buttons under the text rather than squeezing it. */}
      <span className="min-w-[12rem] flex-1">
        {interrupted
          ? t('Clyde was closed while the agent was working.')
          : status === 'error'
            ? t('This session ended with an error. Resume it to go on.')
            : t('This session has ended. Resume it, or just write to it.')}
      </span>
      {interrupted && (
        <Button size="xs" loading={resuming} onClick={() => void resume(view.info.id, true)}>
          <Play /> {t('Resume and carry on')}
        </Button>
      )}
      <Button size="xs" variant={interrupted ? 'ghost' : 'outline'} loading={resuming && !interrupted} onClick={() => void resume(view.info.id)}>
        <RotateCcw /> {t('Resume')}
      </Button>
    </div>
  )
}

const compactTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** How full the context is, with the ways to free it. */
export function ContextBar({ view }: { view: SessionView }) {
  const suggestAt = useSettings((s) => s.settings.memory.compactSuggestPct)
  const compact = useAgents((s) => s.compact)
  const continueWithSummary = useAgents((s) => s.continueWithSummary)
  const starting = useAgents((s) => s.starting)
  const [compacting, setCompacting] = useState(false)
  const context = view.context
  if (!context || ENDED_STATUSES.has(view.info.status)) return null
  const pct = context.window ? Math.min(100, Math.round((context.tokens / context.window) * 100)) : null
  const suggest = pct !== null && pct >= suggestAt
  const busy = view.info.status === 'running' || view.info.status === 'awaiting-approval'
  // Antigravity's /compact is not documented: only a new session with a summary is offered there.
  const canCompact = view.info.kind !== 'antigravity'
  return (
    <div
      className={cn('flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[11px] text-muted-foreground', suggest && 'bg-warning/10')}
      aria-label={t('Context of this session')}
      data-testid="context-bar"
    >
      <span>{t('Context')}</span>
      {pct !== null && (
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('Context used')}>
          <span className={cn('block h-full rounded-full', suggest ? 'bg-warning' : 'bg-primary/70')} style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className="tabular-nums">
        {context.window
          ? t('{used} of {window} tokens ({pct}%)', { used: compactTokens(context.tokens), window: compactTokens(context.window), pct: pct ?? 0 })
          : t('{used} tokens', { used: compactTokens(context.tokens) })}
      </span>
      {suggest && <span className="text-foreground">{t('Compact to keep answers sharp and cheaper.')}</span>}
      <span className="ml-auto flex items-center gap-1">
        {canCompact && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            loading={compacting}
            title={t('Replaces the conversation so far with a summary, in the same session.')}
            onClick={() => {
              setCompacting(true)
              void compact(view.info.id).finally(() => setCompacting(false))
            }}
          >
            <FoldVertical /> {t('Compact')}
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          loading={starting}
          title={t('Ends this session and starts the same agent with a summary of it.')}
          onClick={() => void continueWithSummary(view.info.id)}
        >
          <StepForward /> {t('New session with summary')}
        </Button>
      </span>
    </div>
  )
}

export function SessionPane({ view }: { view: SessionView }) {
  const profile = profileById(useProfiles((s) => s.profiles), view.info.profileId)
  const scroller = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const lastTop = useRef(0)
  const last = view.items.at(-1)

  // Follow the conversation unless the user scrolled up to read; glide when animations are on.
  useEffect(() => {
    const el = scroller.current
    if (!el || !stuck.current) return
    const smooth = document.documentElement.dataset['motion'] === 'full'
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [view.items.length, last])

  const limit = view.rateLimit
  const subscription = profile?.auth === 'subscription'
  const sessionId = view.info.id
  const planUse = useLimits((s) => s.sessions[sessionId])
  const loadPlanUse = useLimits((s) => s.loadSession)
  useEffect(() => {
    if (subscription) void loadPlanUse(sessionId)
  }, [subscription, sessionId, loadPlanUse])
  const [switching, setSwitching] = useState(false)
  const busy = view.info.status === 'running' || view.info.status === 'awaiting-approval' || view.info.status === 'starting'
  return (
    <div className="flex h-full min-h-0 flex-col" data-session={view.info.id} data-status={view.info.status}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 text-[11px] text-muted-foreground">
        {profile ? <ProfileBadge profile={profile} className="font-medium text-foreground" /> : <span>{t('Deleted account')}</span>}
        <span className="font-mono">{view.info.model || t('default model')}</span>
        {view.info.effort && <span title={t('Reasoning effort')}>· {t(EFFORT_LABELS[view.info.effort])}</span>}
        <span>· {t(PERMISSION_LEVEL_LABELS[view.info.permissionLevel])}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <StatusDot status={view.info.status} />
          {t(STATUS_LABELS[view.info.status])}
          {!subscription && view.totals.costUsd > 0 && <span>· {usd(view.totals.costUsd)}</span>}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t('Switch account or model')}
            title={busy ? t('Wait for the agent to finish its turn, or interrupt it.') : t('Switch account or model')}
            disabled={busy || !view.resumable}
            onClick={() => setSwitching(true)}
          >
            <ArrowLeftRight />
          </Button>
        </span>
      </div>
      <SwitchDialog view={view} open={switching} onOpenChange={setSwitching} />
      <LimitBar view={view} onSwitch={() => setSwitching(true)} />
      {/* A rejection is LimitBar's once the turn ended. */}
      {limit && limit.status !== 'allowed' && !(limit.status === 'rejected' && view.limit) && (
        <p
          className={cn(
            'flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5 text-[11px]',
            limit.status === 'rejected' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10'
          )}
        >
          <Gauge className="size-3.5" />
          {limit.status === 'rejected' ? t('Usage limit reached') : t('Close to the usage limit')}
          {limit.resetsAt && ` · ${t('resets {time}', { time: new Date(limit.resetsAt * 1000).toLocaleTimeString(intlLocale()) })}`}
        </p>
      )}
      {subscription && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11px] text-muted-foreground" aria-label={t('Plan use of this session')}>
          <span>{t('This session')}</span>
          <SessionLimitLine usage={planUse ?? []} />
        </div>
      )}
      <ResumeBar view={view} />
      <ContextBar view={view} />
      <div
        ref={scroller}
        onScroll={(e) => {
          // Only scrolling up lets go (a smooth auto-scroll in flight only goes down); reaching the end follows again.
          const el = e.currentTarget
          const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          if (atEnd) stuck.current = true
          else if (el.scrollTop < lastTop.current - 2) stuck.current = false
          lastTop.current = el.scrollTop
        }}
        className="selectable min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {view.items.length === 0 && (
          <p className="pt-6 text-center text-xs text-muted-foreground">
            {view.info.status === 'starting' ? t('Starting {cli}…', { cli: kindLabel(view.info.kind) }) : t('Ask something to start.')}
          </p>
        )}
        <TranscriptRows view={view} subscription={subscription} />
        {view.info.status === 'running' && last?.kind !== 'text' && !(last?.kind === 'thinking' && !last.final) && (
          <Appear>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <StatusDot status="running" /> {t('Working…')}
            </p>
          </Appear>
        )}
      </div>
      <SessionComposer view={view} />
    </div>
  )
}
