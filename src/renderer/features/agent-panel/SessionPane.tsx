import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { intlLocale, t, tk } from '@shared/i18n'
import { ArrowUp, CircleAlert, Gauge, Square } from 'lucide-react'
import { PERMISSION_LEVEL_LABELS, type AgentStatus } from '@shared/agent'
import { kindLabel } from '@shared/profiles'
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
import { Appear } from '@/components/Appear'

export const STATUS_LABELS: Record<AgentStatus, string> = {
  starting: tk('Starting'),
  idle: tk('Ready'),
  running: tk('Working'),
  'awaiting-approval': tk('Needs approval'),
  stopped: tk('Stopped'),
  error: tk('Ended with an error')
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
  subscription = false,
  streaming = false
}: {
  item: TranscriptItem
  cwd: string
  ended: boolean
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
    case 'tool':
      return <ToolCard tool={item} cwd={cwd} ended={ended} />
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
  }
}

export function itemKey(item: TranscriptItem): string {
  switch (item.kind) {
    case 'user':
    case 'turn':
    case 'error':
      return `${item.kind}-${item.id}`
    case 'text':
      return `text-${item.key}`
    case 'tool':
      return `tool-${item.toolUseId}`
  }
}

function Composer({ view }: { view: SessionView }) {
  const send = useAgents((s) => s.send)
  const interrupt = useAgents((s) => s.interrupt)
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const status = view.info.status
  const ended = ENDED_STATUSES.has(status)
  const busy = status === 'running' || status === 'awaiting-approval'

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  const submit = async () => {
    const value = text.trim()
    if (!value || ended || status === 'starting') return
    setText('')
    if (!(await send(value))) setText(value)
  }

  return (
    <div className="border-t p-2">
      <div className="flex items-end gap-1.5 rounded-lg border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
        <textarea
          ref={area}
          rows={1}
          value={text}
          disabled={ended}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={ended ? t('This session has ended') : busy ? t('Queue a follow-up…') : t('Ask the agent… (Enter to send)')}
          aria-label={t('Message to the agent')}
          className="max-h-[200px] min-h-6 flex-1 resize-none bg-transparent py-0.5 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        {busy ? (
          <Button type="button" size="icon-xs" variant="outline" aria-label={t('Interrupt the agent')} onClick={() => void interrupt()}>
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button type="button" size="icon-xs" aria-label={t('Send')} disabled={!text.trim() || ended} onClick={() => void submit()}>
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  )
}

export function SessionPane({ view }: { view: SessionView }) {
  const profile = profileById(useProfiles((s) => s.profiles), view.info.profileId)
  const scroller = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const lastTop = useRef(0)
  const ended = ENDED_STATUSES.has(view.info.status)
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
  return (
    <div className="flex h-full min-h-0 flex-col" data-session={view.info.id} data-status={view.info.status}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 text-[11px] text-muted-foreground">
        {profile ? <ProfileBadge profile={profile} className="font-medium text-foreground" /> : <span>{t('Deleted account')}</span>}
        <span className="font-mono">{view.info.model || t('default model')}</span>
        <span>· {t(PERMISSION_LEVEL_LABELS[view.info.permissionLevel])}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <StatusDot status={view.info.status} />
          {t(STATUS_LABELS[view.info.status])}
          {!subscription && view.totals.costUsd > 0 && <span>· {usd(view.totals.costUsd)}</span>}
        </span>
      </div>
      {limit && limit.status !== 'allowed' && (
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
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {view.items.length === 0 && (
          <p className="pt-6 text-center text-xs text-muted-foreground">
            {view.info.status === 'starting' ? t('Starting {cli}…', { cli: kindLabel(view.info.kind) }) : t('Ask something to start.')}
          </p>
        )}
        {view.items.map((item) => (
          <Appear key={itemKey(item)}>
            <Item
              item={item}
              cwd={view.info.cwd}
              ended={ended}
              subscription={subscription}
              streaming={item === last && item.kind === 'text' && !item.final && view.info.status === 'running'}
            />
          </Appear>
        ))}
        {view.info.status === 'running' && last?.kind !== 'text' && (
          <Appear>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <StatusDot status="running" /> {t('Working…')}
            </p>
          </Appear>
        )}
      </div>
      <Composer view={view} />
    </div>
  )
}
