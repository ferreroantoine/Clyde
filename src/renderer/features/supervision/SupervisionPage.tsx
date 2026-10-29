import { useEffect, useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CircleAlert, Gauge, History, RefreshCw, TriangleAlert } from 'lucide-react'
import { daysIn, type Dashboard, type MetricsRange, type ProfileUsage, type SessionRecord } from '@shared/metrics'
import { PROFILE_KIND_LABELS } from '@shared/profiles'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/EmptyState'
import { ProfileDot } from '@/components/ProfileBadge'
import { Item, itemKey, STATUS_LABELS, StatusDot, tokens, usd } from '@/features/agent-panel/SessionPane'
import { on } from '@/lib/ipc'
import { applyEvent, emptyView } from '@/lib/transcript'
import { useSupervision } from '@/stores/supervision'
import { cn } from '@/lib/utils'

const RANGES: Array<{ value: MetricsRange; label: string }> = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' }
]

/** "Local" for Ollama, "—" when nothing could be priced, "~" before estimates. */
function cost(value: number, estimated: boolean, kind: ProfileUsage['kind'], unpriced = false): string {
  if (kind === 'ollama') return 'Local'
  if (estimated && value === 0 && unpriced) return '—'
  return `${estimated ? '~' : ''}${usd(value)}`
}

const shortDate = (ms: number) =>
  new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function RateLimit({ limit }: { limit: NonNullable<ProfileUsage['rateLimit']> }) {
  const pct = limit.utilization !== null ? Math.round(limit.utilization * 100) : null
  const label =
    limit.status === 'rejected' ? 'Limit reached' : limit.status === 'allowed_warning' ? 'Close to the limit' : 'Within limits'
  return (
    <div className="space-y-1" aria-label={`Usage limit: ${label}`}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1">
          {limit.status !== 'allowed' && (
            <TriangleAlert className={cn('size-3', limit.status === 'rejected' ? 'text-destructive' : 'text-warning')} />
          )}
          {label}
          {limit.limitType && <span className="text-muted-foreground">· {limit.limitType.replace(/_/g, ' ')}</span>}
        </span>
        {pct !== null && <span className="tabular-nums">{pct}%</span>}
      </div>
      {pct !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full',
              limit.status === 'rejected' ? 'bg-destructive' : limit.status === 'allowed_warning' ? 'bg-warning' : 'bg-success'
            )}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
      {limit.resetsAt && (
        <p className="text-[11px] text-muted-foreground">Resets {new Date(limit.resetsAt * 1000).toLocaleString()}</p>
      )}
    </div>
  )
}

function ProfileCard({ usage }: { usage: ProfileUsage }) {
  return (
    <article className="relative space-y-3 overflow-hidden rounded-xl border bg-card p-4 pl-5 shadow-xs" aria-label={`Usage of ${usage.name}`}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: usage.color }} />
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{usage.name}</h3>
          <p className="text-[11px] text-muted-foreground">{PROFILE_KIND_LABELS[usage.kind]}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusDot status={usage.activeSessions ? 'running' : 'stopped'} />
          {usage.activeSessions} active
        </span>
      </header>
      <dl className="grid grid-cols-3 gap-2">
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">Sessions</dt>
          <dd className="text-lg font-semibold tabular-nums">{usage.sessions}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">Tokens</dt>
          <dd className="text-lg font-semibold tabular-nums">{tokens(usage.inputTokens + usage.outputTokens)}</dd>
          <dd className="truncate text-[11px] text-muted-foreground tabular-nums">
            {tokens(usage.inputTokens)} in · {tokens(usage.outputTokens)} out
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{usage.costEstimated && usage.kind !== 'ollama' ? 'Est. cost' : 'Cost'}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {cost(usage.costUsd, usage.costEstimated, usage.kind, usage.unpricedTurns > 0)}
          </dd>
        </div>
      </dl>
      {usage.unpricedTurns > 0 && (
        <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <CircleAlert className="mt-px size-3 shrink-0" />
          {usage.unpricedTurns} turn{usage.unpricedTurns > 1 ? 's' : ''} without a known price. Add the model in Settings › Prices.
        </p>
      )}
      {usage.rateLimit && <RateLimit limit={usage.rateLimit} />}
    </article>
  )
}

/** One stacked bar per day, one segment per account in its own color. */
function DailyChart({
  dashboard,
  metric,
  title,
  format
}: {
  dashboard: Dashboard
  metric: 'tokens' | 'cost'
  title: string
  format: (n: number) => string
}) {
  const series = dashboard.profiles.filter((p) => p.sessions > 0)
  const data = useMemo(() => {
    const rows = daysIn(dashboard.range, dashboard.generatedAt).map((day) => ({ day, ...Object.fromEntries(series.map((p) => [p.profileId, 0])) }) as Record<string, number | string>)
    for (const d of dashboard.daily) {
      const row = rows.find((r) => r['day'] === d.day)
      if (!row || !(d.profileId in row)) continue
      row[d.profileId] = (row[d.profileId] as number) + (metric === 'tokens' ? d.inputTokens + d.outputTokens : d.costUsd)
    }
    return rows
  }, [dashboard, metric, series])

  return (
    <figure className="rounded-xl border bg-card p-4 shadow-xs">
      <figcaption className="mb-3 text-xs font-medium">{title}</figcaption>
      <div className="h-56" role="img" aria-label={`${title}, per day and per account`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="day"
              tickFormatter={(d: string) => d.slice(5)}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={format}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              cursor={{ fill: 'var(--accent)', opacity: 0.5 }}
              formatter={(value, name) => [format(Number(value)), series.find((p) => p.profileId === name)?.name ?? String(name)]}
              labelFormatter={(d) => String(d)}
              contentStyle={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--popover-foreground)'
              }}
              itemStyle={{ color: 'var(--popover-foreground)' }}
            />
            <Legend
              formatter={(id) => <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>{series.find((p) => p.profileId === id)?.name ?? id}</span>}
              iconType="circle"
              iconSize={8}
            />
            {series.map((p, i) => (
              <Bar
                key={p.profileId}
                dataKey={p.profileId}
                stackId="usage"
                fill={p.color}
                // A 2px surface gap keeps neighbouring accounts apart even when their colors are close.
                stroke="var(--card)"
                strokeWidth={2}
                radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={36}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

function Transcript() {
  const transcript = useSupervision((s) => s.transcript)
  const close = useSupervision((s) => s.closeTranscript)
  const view = useMemo(() => {
    if (!transcript) return null
    const s = transcript.session
    const base = emptyView({
      id: s.id,
      profileId: s.profileId,
      kind: s.kind,
      model: s.model,
      permissionLevel: 'validate-all',
      cwd: s.cwd,
      mcpTools: [],
      agentId: s.agentId,
      taskId: s.taskId,
      status: 'stopped',
      createdAt: s.startedAt
    })
    return transcript.events.reduce(applyEvent, base)
  }, [transcript])
  return (
    <Dialog open={!!transcript} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{transcript?.session.title ?? 'Session'}</DialogTitle>
          <DialogDescription>
            {transcript && `${transcript.session.profileName} · ${transcript.session.model || 'default model'} · ${new Date(transcript.session.startedAt).toLocaleString()}`}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-label="Transcript">
          {view?.items.length === 0 && <p className="text-xs text-muted-foreground">No message in this session.</p>}
          {view?.items.map((item) => <Item key={itemKey(item)} item={item} cwd={view.info.cwd} ended />)}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SessionsTable({ sessions }: { sessions: SessionRecord[] }) {
  const open = useSupervision((s) => s.openTranscript)
  const profiles = useSupervision((s) => s.dashboard?.profiles ?? [])
  if (sessions.length === 0) return <p className="px-4 py-6 text-center text-xs text-muted-foreground">No session in this period.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 font-medium">Started</th>
            <th className="px-2 py-2 font-medium">Account</th>
            <th className="px-2 py-2 font-medium">Session</th>
            <th className="px-2 py-2 font-medium">Model</th>
            <th className="px-2 py-2 text-right font-medium">Turns</th>
            <th className="px-2 py-2 text-right font-medium">Tokens</th>
            <th className="px-2 py-2 text-right font-medium">Cost</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const color = profiles.find((p) => p.profileId === s.profileId)?.color
            return (
              <tr
                key={s.id}
                tabIndex={0}
                onClick={() => void open(s.id)}
                onKeyDown={(e) => e.key === 'Enter' && void open(s.id)}
                className="cursor-pointer border-b last:border-0 hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
                data-session-row={s.id}
              >
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground tabular-nums">{shortDate(s.startedAt)}</td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    {color && <ProfileDot color={color} />}
                    {s.profileName}
                  </span>
                </td>
                <td className="max-w-72 truncate px-2 py-2" title={s.title ?? undefined}>
                  {s.title ?? <span className="text-muted-foreground">(no message)</span>}
                  {s.taskId && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">task</span>}
                </td>
                <td className="px-2 py-2 font-mono text-[11px] whitespace-nowrap">{s.model || 'default'}</td>
                <td className="px-2 py-2 text-right tabular-nums">{s.turns}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">{tokens(s.inputTokens + s.outputTokens)}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">{cost(s.costUsd, s.costEstimated, s.kind, true)}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    <StatusDot status={s.status} />
                    {STATUS_LABELS[s.status]}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function SupervisionPage() {
  const dashboard = useSupervision((s) => s.dashboard)
  const range = useSupervision((s) => s.range)
  const loading = useSupervision((s) => s.loading)
  const load = useSupervision((s) => s.load)

  useEffect(() => {
    void load()
    // Refresh when turns finish or sessions change state; coalesce bursts.
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), 600)
    }
    const offs = [
      on('agent:event', ({ event }) => {
        if (event.type === 'turn_end' || event.type === 'rate_limit') refresh()
      }),
      on('agent:session', refresh)
    ]
    return () => {
      if (timer) clearTimeout(timer)
      offs.forEach((off) => off())
    }
  }, [load])

  const hasUsage = !!dashboard && (dashboard.sessions.length > 0 || dashboard.profiles.some((p) => p.sessions > 0))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Supervision</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sessions, tokens, cost and usage limits per account. Claude Code reports its cost; API costs are estimates from
              Settings › Prices.
            </p>
          </div>
          <div className="flex items-center gap-2" role="group" aria-label="Period">
            <div className="flex rounded-lg border bg-muted p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={range === r.value}
                  onClick={() => void load(r.value)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs transition-colors',
                    range === r.value ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button size="icon-sm" variant="ghost" aria-label="Refresh" onClick={() => void load()}>
              <RefreshCw className={loading ? 'animate-spin' : undefined} />
            </Button>
          </div>
        </div>

        {dashboard && dashboard.profiles.length === 0 ? (
          <div className="rounded-xl border border-dashed py-14">
            <EmptyState icon={Gauge} title="No account yet" description="Add an account and start an agent; its usage shows here." />
          </div>
        ) : (
          dashboard && (
            <>
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Accounts">
                {dashboard.profiles.map((p) => (
                  <ProfileCard key={p.profileId} usage={p} />
                ))}
              </section>
              {hasUsage ? (
                <section className="grid gap-3 lg:grid-cols-2" aria-label="Charts">
                  <DailyChart dashboard={dashboard} metric="tokens" title="Tokens per day" format={tokens} />
                  <DailyChart dashboard={dashboard} metric="cost" title="Cost per day (USD)" format={(n) => usd(n)} />
                </section>
              ) : (
                <div className="rounded-xl border border-dashed py-10">
                  <EmptyState icon={Gauge} title="No usage in this period" description="Charts appear once an agent has finished a turn." />
                </div>
              )}
              <section className="rounded-xl border bg-card shadow-xs" aria-label="History">
                <h2 className="flex items-center gap-1.5 border-b px-4 py-2.5 text-xs font-medium">
                  <History className="size-3.5" /> History
                  <span className="font-normal text-muted-foreground">· click a session to read it</span>
                </h2>
                <SessionsTable sessions={dashboard.sessions} />
              </section>
            </>
          )
        )}
      </div>
      <Transcript />
    </div>
  )
}
