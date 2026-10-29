import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, CircleAlert, Gauge, Square } from 'lucide-react'
import { PERMISSION_LEVEL_LABELS, type AgentStatus } from '@shared/agent'
import { Button } from '@/components/ui/button'
import { ProfileBadge } from '@/components/ProfileBadge'
import type { SessionView, TranscriptItem } from '@/lib/transcript'
import { ENDED_STATUSES, useAgents } from '@/stores/agents'
import { profileById, useProfiles } from '@/stores/profiles'
import { cn } from '@/lib/utils'
import { RichText } from './RichText'
import { ToolCard } from './ToolCard'

export const STATUS_LABELS: Record<AgentStatus, string> = {
  starting: 'Starting',
  idle: 'Ready',
  running: 'Working',
  'awaiting-approval': 'Needs approval',
  stopped: 'Stopped',
  error: 'Ended with an error'
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

const usd = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`)
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function Item({ item, cwd, ended }: { item: TranscriptItem; cwd: string; ended: boolean }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-6 rounded-lg bg-primary/10 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
          {item.text}
        </div>
      )
    case 'text':
      return <RichText text={item.text} />
    case 'tool':
      return <ToolCard tool={item} cwd={cwd} ended={ended} />
    case 'turn':
      return (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-turn={item.subtype}>
          {item.isError && <CircleAlert className="size-3 text-destructive" />}
          {item.isError ? item.errors[0] ?? `Turn ended: ${item.subtype.replace(/_/g, ' ')}` : 'Done'}
          <span>
            · {(item.durationMs / 1000).toFixed(1)}s · {tokens(item.inputTokens)} in / {tokens(item.outputTokens)} out
            {item.costUsd !== null && ` · ${usd(item.costUsd)}`}
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

function itemKey(item: TranscriptItem): string {
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
          placeholder={ended ? 'This session has ended' : busy ? 'Queue a follow-up…' : 'Ask the agent… (Enter to send)'}
          aria-label="Message to the agent"
          className="max-h-[200px] min-h-6 flex-1 resize-none bg-transparent py-0.5 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        {busy ? (
          <Button type="button" size="icon-xs" variant="outline" aria-label="Interrupt the agent" onClick={() => void interrupt()}>
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button type="button" size="icon-xs" aria-label="Send" disabled={!text.trim() || ended} onClick={() => void submit()}>
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
  const ended = ENDED_STATUSES.has(view.info.status)
  const last = view.items.at(-1)

  // Follow the conversation unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
  }, [view.items.length, last])

  const limit = view.rateLimit
  return (
    <div className="flex h-full min-h-0 flex-col" data-session={view.info.id} data-status={view.info.status}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 text-[11px] text-muted-foreground">
        {profile ? <ProfileBadge profile={profile} className="font-medium text-foreground" /> : <span>Deleted account</span>}
        <span className="font-mono">{view.info.model || 'default model'}</span>
        <span>· {PERMISSION_LEVEL_LABELS[view.info.permissionLevel]}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <StatusDot status={view.info.status} />
          {STATUS_LABELS[view.info.status]}
          {view.totals.costUsd > 0 && <span>· {usd(view.totals.costUsd)}</span>}
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
          {limit.status === 'rejected' ? 'Usage limit reached' : 'Close to the usage limit'}
          {limit.utilization !== null && ` (${Math.round(limit.utilization * 100)}%)`}
          {limit.resetsAt && ` · resets ${new Date(limit.resetsAt * 1000).toLocaleTimeString()}`}
        </p>
      )}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {view.items.length === 0 && (
          <p className="pt-6 text-center text-xs text-muted-foreground">
            {view.info.status === 'starting' ? 'Starting Claude Code…' : 'Ask something to start.'}
          </p>
        )}
        {view.items.map((item) => (
          <Item key={itemKey(item)} item={item} cwd={view.info.cwd} ended={ended} />
        ))}
        {view.info.status === 'running' && last?.kind !== 'text' && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <StatusDot status="running" /> Working…
          </p>
        )}
      </div>
      <Composer view={view} />
    </div>
  )
}
