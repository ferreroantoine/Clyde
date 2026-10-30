import { useEffect, useMemo, useState } from 'react'
import { intlLocale, t, tk, tn } from '@shared/i18n'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CircleAlert, CircleCheck, Gauge, History, LoaderCircle, RefreshCw, Stethoscope } from 'lucide-react'
import type { Billing, LimitDiagnostic } from '@shared/limits'
import { LimitGauge, SessionLimitLine, useNow } from '@/features/limits/LimitGauge'
import { useLimits } from '@/stores/limits'
import { daysIn, type Dashboard, type MetricsRange, type ProfileUsage, type SessionRecord } from '@shared/metrics'
import { isApiKind, kindLabel } from '@shared/profiles'
import type { ContextBreakdown } from '@shared/agent'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/EmptyState'
import { ProfileDot } from '@/components/ProfileBadge'
import { Item, itemKey, STATUS_LABELS, StatusDot, tokens, usd } from '@/features/agent-panel/SessionPane'
import { on } from '@/lib/ipc'
import { applyEvent, emptyView } from '@/lib/transcript'
import { useSupervision } from '@/stores/supervision'
import { cn } from '@/lib/utils'
import { Appear } from '@/components/Appear'
import { SkeletonCards } from '@/components/Skeleton'

const RANGES: Array<{ value: MetricsRange; label: string }> = [
  { value: '24h', label: tk('24 hours') },
  { value: '7d', label: tk('7 days') },
  { value: '30d', label: tk('30 days') }
]

/** "Local" for local models, "—" when nothing could be priced, "~" before estimates. */
function cost(value: number, estimated: boolean, billing: Billing, unpriced = false): string {
  if (billing === 'local') return 'Local'
  if (estimated && value === 0 && unpriced) return '—'
  return `${estimated ? '~' : ''}${usd(value)}`
}

const shortDate = (ms: number) =>
  new Date(ms).toLocaleString(intlLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Every source of an account's limits, raw, so a missing value can be explained. */
function DiagnosticDialog({ profileId, onClose }: { profileId: string | null; onClose: () => void }) {
  const diagnose = useLimits((s) => s.diagnose)
  const [results, setResults] = useState<LimitDiagnostic[] | null>(null)
  useEffect(() => {
    if (!profileId) return
    let live = true
    void diagnose(profileId).then((r) => live && setResults(r ?? []))
    return () => {
      live = false
      setResults(null)
    }
  }, [profileId, diagnose])
  return (
    <Dialog open={!!profileId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Usage limits diagnostic')}</DialogTitle>
          <DialogDescription>{t('What each source answered for this account. Keys and tokens are masked.')}</DialogDescription>
        </DialogHeader>
        {results === null ? (
          <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> {' '}{t('Asking the CLI… (it starts without sending a prompt)')}</p>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {results.map((r) => (
              <section key={r.source} className="space-y-1">
                <h3 className="flex items-center gap-1.5 text-xs font-medium">
                  {r.ok ? <CircleCheck className="size-3.5 text-success" /> : <CircleAlert className="size-3.5 text-destructive" />}
                  {r.source}
                </h3>
                <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{r.output}</pre>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PlanLimits({ usage, onDiagnose }: { usage: ProfileUsage; onDiagnose: () => void }) {
  const limits = useLimits((s) => s.profiles[usage.profileId])
  const refresh = useLimits((s) => s.refresh)
  const refreshing = useLimits((s) => s.refreshing)
  const windows = limits?.windows ?? []
  return (
    <div className="space-y-2.5" aria-label={t('Plan limits')}>
      {windows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t('No reading yet.')}</p>
      ) : (
        windows.map((w) => <LimitGauge key={w.window} state={w} color={usage.color} />)
      )}
      <div className="flex items-center gap-1">
        <Button size="xs" variant="ghost" disabled={refreshing} onClick={() => void refresh(usage.profileId)}>
          <RefreshCw className={refreshing ? 'animate-spin' : undefined} /> {' '}{t('Read now')}</Button>
        <Button size="xs" variant="ghost" onClick={onDiagnose}>
          <Stethoscope /> {' '}{t('Diagnostic')}</Button>
      </div>
    </div>
  )
}

function ProfileCard({ usage, onDiagnose }: { usage: ProfileUsage; onDiagnose: () => void }) {
  return (
    <article className="relative space-y-3 overflow-hidden rounded-xl border bg-card p-4 pl-5 shadow-xs" aria-label={t('Usage of {name}', { name: usage.name })}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: usage.color }} />
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{usage.name}</h3>
          <p className="text-[11px] text-muted-foreground">
            {kindLabel(usage.kind)}
            {usage.billing === 'subscription' && ` · ${t('subscription')}`}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusDot status={usage.activeSessions ? 'running' : 'stopped'} />
          {t('{count} active', { count: usage.activeSessions })}
        </span>
      </header>
      <dl className={cn('grid gap-2', usage.billing === 'subscription' ? 'grid-cols-2' : 'grid-cols-3')}>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{t('Sessions')}</dt>
          <dd className="text-lg font-semibold tabular-nums">{usage.sessions}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{t('Tokens')}</dt>
          <dd className="text-lg font-semibold tabular-nums">{tokens(usage.inputTokens + usage.outputTokens)}</dd>
          <dd className="truncate text-[11px] text-muted-foreground tabular-nums">
            {t('{input} in · {output} out', { input: tokens(usage.inputTokens), output: tokens(usage.outputTokens) })}
          </dd>
        </div>
        {usage.billing !== 'subscription' && (
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{usage.costEstimated && usage.billing === 'api' ? t('Est. cost') : t('Cost')}</dt>
            <dd className="text-lg font-semibold tabular-nums">{cost(usage.costUsd, usage.costEstimated, usage.billing, usage.unpricedTurns > 0)}</dd>
          </div>
        )}
      </dl>
      {usage.cacheReadTokens > 0 && usage.inputTokens > 0 && (
        <p className="text-[11px] text-muted-foreground tabular-nums" title={t('Input tokens read from the provider’s prompt cache, billed at a fraction of the price.')}>
          {t('Cache: {pct}% of input tokens ({count})', { pct: Math.round((usage.cacheReadTokens / usage.inputTokens) * 100), count: tokens(usage.cacheReadTokens) })}
        </p>
      )}
      {usage.unpricedTurns > 0 && (
        <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <CircleAlert className="mt-px size-3 shrink-0" />
          {tn('{count} turn without a known price. Add the model in Settings › Prices.', '{count} turns without a known price. Add the model in Settings › Prices.', usage.unpricedTurns)}
        </p>
      )}
      {usage.billing === 'subscription' && <PlanLimits usage={usage} onDiagnose={onDiagnose} />}
    </article>
  )
}

const BREAKDOWN_PARTS: Array<{ key: keyof ContextBreakdown; label: string; color: string }> = [
  { key: 'system', label: tk('Instructions'), color: '#64748b' },
  { key: 'memory', label: tk('Memory'), color: '#a855f7' },
  { key: 'tools', label: tk('Tool definitions'), color: '#0ea5e9' },
  { key: 'history', label: tk('Conversation'), color: '#6366f1' },
  { key: 'toolResults', label: tk('Tool results'), color: '#f97316' },
  { key: 'output', label: tk('Answers'), color: '#22c55e' }
]

/** "Where my tokens go": the parts of every request, summed over the sessions Atelier's loop ran. */
function TokenBreakdown({ sessions }: { sessions: SessionRecord[] }) {
  const measured = sessions.filter((s) => s.breakdown)
  const cli = sessions.filter((s) => !isApiKind(s.kind)).length
  const sums = BREAKDOWN_PARTS.map((part) => ({ ...part, value: measured.reduce((n, s) => n + (s.breakdown?.[part.key] ?? 0), 0) }))
  const total = sums.reduce((n, p) => n + p.value, 0)
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 shadow-xs" aria-label={t('Where the tokens go')} data-testid="token-breakdown">
      <div>
        <h2 className="text-xs font-medium">{t('Where the tokens go')}</h2>
        <p className="text-[11px] text-muted-foreground">
          {t('Each request resends the instructions, memory, tool definitions and conversation so far: the biggest part is where saving pays.')}
        </p>
      </div>
      {total > 0 ? (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={sums.map((p) => `${t(p.label)} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
            {sums.map((p) => p.value > 0 && <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, backgroundColor: p.color }} title={t(p.label)} />)}
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
            {sums.map((p) => (
              <li key={p.key} className="flex items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="text-muted-foreground">{t(p.label)}</span>
                <span className="ml-auto tabular-nums">
                  {tokens(p.value)} · {Math.round((p.value / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">{t('No API or Ollama session in this period.')}</p>
      )}
      {cli > 0 && (
        <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <CircleAlert className="mt-px size-3 shrink-0" />
          {tn(
            '{count} CLI session not included: Claude Code, Codex and Antigravity report totals only (not reported).',
            '{count} CLI sessions not included: Claude Code, Codex and Antigravity report totals only (not reported).',
            cli
          )}
        </p>
      )}
    </section>
  )
}

/** The 5-hour and weekly use of one plan over the last 7 days. */
function LimitHistoryChart({ usage }: { usage: ProfileUsage }) {
  const history = useLimits((s) => s.history[usage.profileId])
  const loadHistory = useLimits((s) => s.loadHistory)
  useEffect(() => {
    void loadHistory(usage.profileId)
  }, [usage.profileId, loadHistory])
  const data = useMemo(() => {
    const points = new Map<number, Record<string, number>>()
    for (const serie of history?.series ?? []) {
      for (const p of serie.points) points.set(p.at, { ...(points.get(p.at) ?? { at: p.at }), [serie.window]: p.usedPct })
    }
    return [...points.values()].sort((a, b) => (a['at'] as number) - (b['at'] as number))
  }, [history])
  const now = useNow(60_000)
  // One tick per local midnight, so each day shows once.
  const dayTicks = useMemo(() => {
    const ticks: number[] = []
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    for (let i = 0; i < 7; i++) ticks.unshift(d.getTime() - i * 86_400_000)
    return ticks
  }, [now])
  return (
    <figure className="rounded-xl border bg-card p-4 shadow-xs">
      <figcaption className="mb-3 flex items-center gap-1.5 text-xs font-medium">
        <ProfileDot color={usage.color} /> {t('{name} · plan use, last 7 days', { name: usage.name })}
      </figcaption>
      {data.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">{t('No reading in the last 7 days.')}</p>
      ) : (
        <div className="h-48" role="img" aria-label={t('5-hour and weekly use of {name} over 7 days', { name: usage.name })}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="at"
                type="number"
                scale="time"
                domain={[now - 7 * 86_400_000, now]}
                ticks={dayTicks}
                tickFormatter={(ms: number) => new Date(ms).toLocaleDateString(intlLocale(), { weekday: 'short' })}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <YAxis domain={[0, 100]} tickFormatter={(n: number) => `${n}%`} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                labelFormatter={(ms) => new Date(Number(ms)).toLocaleString(intlLocale())}
                formatter={(value, name) => [`${value}%`, name === 'five_hour' ? t('5-hour window') : t('Weekly')]}
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--popover-foreground)' }}
              />
              <Legend
                formatter={(id) => <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>{id === 'five_hour' ? t('5-hour window') : t('Weekly')}</span>}
                iconType="plainline"
              />
              <Line dataKey="five_hour" stroke={usage.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="seven_day" stroke={usage.color} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
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
  // Plans have no per-token price: the cost chart only shows API accounts.
  const series = dashboard.profiles.filter((p) => p.sessions > 0 && (metric === 'tokens' || p.billing === 'api'))
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
      <div className="h-56" role="img" aria-label={t('{title}, per day and per account', { title })}>
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
      chatId: null,
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
            {transcript && `${transcript.session.profileName} · ${transcript.session.model || t('default model')} · ${new Date(transcript.session.startedAt).toLocaleString(intlLocale())}`}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-label={t('Transcript')}>
          {view?.items.length === 0 && <p className="text-xs text-muted-foreground">{t('No message in this session.')}</p>}
          {view?.items.map((item) => (
            <Item key={itemKey(item)} item={item} cwd={view.info.cwd} ended subscription={transcript?.session.billing === 'subscription'} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SessionsTable({ sessions }: { sessions: SessionRecord[] }) {
  const open = useSupervision((s) => s.openTranscript)
  const profiles = useSupervision((s) => s.dashboard?.profiles ?? [])
  if (sessions.length === 0) return <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t('No session in this period.')}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 font-medium">{t('Started')}</th>
            <th className="px-2 py-2 font-medium">{t('Account')}</th>
            <th className="px-2 py-2 font-medium">{t('Session')}</th>
            <th className="px-2 py-2 font-medium">{t('Model')}</th>
            <th className="px-2 py-2 text-right font-medium">{t('Turns')}</th>
            <th className="px-2 py-2 text-right font-medium">{t('Tokens')}</th>
            <th className="px-2 py-2 text-right font-medium">{t('Use')}</th>
            <th className="px-4 py-2 font-medium">{t('Status')}</th>
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
                className="press press-soft cursor-pointer border-b last:border-0 hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
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
                  {s.title ?? <span className="text-muted-foreground">{t('(no message)')}</span>}
                  {s.taskId && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">{t('task')}</span>}
                </td>
                <td className="px-2 py-2 font-mono text-[11px] whitespace-nowrap">{s.model || 'default'}</td>
                <td className="px-2 py-2 text-right tabular-nums">{s.turns}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">{tokens(s.inputTokens + s.outputTokens)}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                  {s.billing === 'subscription' ? <SessionLimitLine usage={s.limits} className="justify-end" /> : cost(s.costUsd, s.costEstimated, s.billing, true)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    <StatusDot status={s.status} />
                    {t(STATUS_LABELS[s.status])}
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
  const [diagnosing, setDiagnosing] = useState<string | null>(null)

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
            <h1 className="text-lg font-semibold tracking-tight">{t('Supervision')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Sessions and tokens per account; plan limits for subscriptions, cost for API accounts (estimates from Settings › Prices). Each value says whether the CLI reported it or Atelier computed it.')}</p>
          </div>
          <div className="flex items-center gap-2" role="group" aria-label={t('Period')}>
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
                  {t(r.label)}
                </button>
              ))}
            </div>
            <Button size="icon-sm" variant="ghost" aria-label={t('Refresh')} onClick={() => void load()}>
              <RefreshCw className={loading ? 'animate-spin' : undefined} />
            </Button>
          </div>
        </div>

        {!dashboard && <SkeletonCards count={3} className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3 space-y-0" />}
        {dashboard && dashboard.profiles.length === 0 ? (
          <div className="rounded-xl border border-dashed py-14">
            <EmptyState icon={Gauge} title={t('No account yet')} description={t('Add an account and start an agent; its usage shows here.')} />
          </div>
        ) : (
          dashboard && (
            <>
              <section className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3" aria-label={t('Accounts')}>
                {dashboard.profiles.map((p) => (
                  <Appear key={p.profileId}>
                    <ProfileCard usage={p} onDiagnose={() => setDiagnosing(p.profileId)} />
                  </Appear>
                ))}
              </section>
              {dashboard.profiles.some((p) => p.billing === 'subscription') && (
                <section className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-3" aria-label={t('Plan limits history')}>
                  {dashboard.profiles
                    .filter((p) => p.billing === 'subscription')
                    .map((p) => (
                      <LimitHistoryChart key={p.profileId} usage={p} />
                    ))}
                </section>
              )}
              {hasUsage ? (
                <section className="grid gap-3 lg:grid-cols-2" aria-label={t('Charts')}>
                  <DailyChart dashboard={dashboard} metric="tokens" title={t('Tokens per day')} format={tokens} />
                  <DailyChart dashboard={dashboard} metric="cost" title={t('API cost per day (USD)')} format={(n) => usd(n)} />
                </section>
              ) : (
                <div className="rounded-xl border border-dashed py-10">
                  <EmptyState icon={Gauge} title={t('No usage in this period')} description={t('Charts appear once an agent has finished a turn.')} />
                </div>
              )}
              {dashboard.sessions.length > 0 && <TokenBreakdown sessions={dashboard.sessions} />}
              <section className="rounded-xl border bg-card shadow-xs" aria-label={t('History')}>
                <h2 className="flex items-center gap-1.5 border-b px-4 py-2.5 text-xs font-medium">
                  <History className="size-3.5" /> {' '}{t('History')}<span className="font-normal text-muted-foreground">{t('· click a session to read it')}</span>
                </h2>
                <SessionsTable sessions={dashboard.sessions} />
              </section>
            </>
          )
        )}
      </div>
      <Transcript />
      <DiagnosticDialog profileId={diagnosing} onClose={() => setDiagnosing(null)} />
    </div>
  )
}
