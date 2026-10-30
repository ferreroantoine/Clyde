import { useEffect, useState } from 'react'
import { intlLocale, t, tk } from '@shared/i18n'
import { formatCountdown, windowLabel, type LimitBadge as Badge, type SessionLimitUsage, type WindowState } from '@shared/limits'
import { cn } from '@/lib/utils'

/** The current time, ticking every 30 s, for countdowns. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

const BADGE_TEXT: Record<Badge, string> = { official: tk('Official'), estimated: tk('Estimated'), unavailable: tk('Unavailable') }
const BADGE_HINT: Record<Badge, string> = {
  official: tk('Reported by the CLI'),
  estimated: tk('Computed by Clyde: several sessions shared the account'),
  unavailable: tk('The CLI does not report this value')
}

export function LimitBadge({ badge, className }: { badge: Badge; className?: string }) {
  return (
    <span
      title={t(BADGE_HINT[badge])}
      data-badge={badge}
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1 text-[10px] leading-4 font-medium',
        badge === 'official' && 'bg-success/15 text-success',
        badge === 'estimated' && 'bg-warning/15 text-warning',
        badge === 'unavailable' && 'bg-muted text-muted-foreground',
        className
      )}
    >
      {t(BADGE_TEXT[badge])}
    </span>
  )
}

/** Red past 90 %, amber past 75 %, the account's color below. */
export function levelColor(pct: number, color?: string): string {
  if (pct >= 90) return 'var(--destructive)'
  if (pct >= 75) return 'var(--warning)'
  return color ?? 'var(--primary)'
}

const resetDate = (ms: number) => new Date(ms).toLocaleString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** One plan window: use, countdown to the reset, its date, and where the value comes from. */
export function LimitGauge({ state, color }: { state: WindowState; color?: string }) {
  const now = useNow()
  const pct = state.usedPct
  const label = windowLabel(state.window, state.label)
  return (
    <div
      className="space-y-1"
      aria-label={pct === null ? t('{window}: unavailable', { window: label }) : t('{window}: {pct}% used', { window: label, pct })}
      data-window={state.window}
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{label}</span>
          <LimitBadge badge={state.badge} />
        </span>
        <span className="tabular-nums">{pct === null ? '—' : `${pct}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        {pct !== null && (
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(100, pct)}%`, background: levelColor(pct, color) }} />
        )}
      </div>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {state.resetsAt !== null && pct !== null
          ? t('Resets in {time} · {date}', { time: formatCountdown(state.resetsAt - now), date: resetDate(state.resetsAt) })
          : state.badge === 'unavailable'
            ? t('No reading yet')
            : t('Reset time unknown')}
      </p>
    </div>
  )
}

/** A thin gauge for the status bar. */
export function MiniGauge({ state, color, short }: { state: WindowState; color: string; short: string }) {
  const now = useNow()
  const pct = state.usedPct
  const label = windowLabel(state.window, state.label)
  const title =
    pct === null
      ? t('{window}: unavailable', { window: label })
      : [
          t('{window}: {pct}% used', { window: label, pct }),
          state.resetsAt ? t('resets in {time}', { time: formatCountdown(state.resetsAt - now) }) : '',
          `(${t(BADGE_TEXT[state.badge]).toLowerCase()})`
        ]
          .filter(Boolean)
          .join(', ')
  return (
    <span className="flex items-center gap-1" title={title} data-window={state.window}>
      <span className="opacity-70">{short}</span>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-foreground/10">
        {pct !== null && <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: levelColor(pct, color) }} />}
      </span>
      <span className="tabular-nums">{pct === null ? '—' : `${Math.round(pct)}%`}</span>
    </span>
  )
}

const SHORT: Record<string, string> = { five_hour: tk('5h'), seven_day: tk('Week') }

/** "5h +3.2 pts · Week +0.8 pts": what a session took from its plan. */
export function SessionLimitLine({ usage, className }: { usage: SessionLimitUsage[]; className?: string }) {
  const main = usage.filter((u) => u.window in SHORT)
  if (main.length === 0) return <span className={cn('text-muted-foreground', className)}>{t('No plan use measured yet')}</span>
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-0.5', className)}>
      {main.map((u) => (
        <span key={u.window} className="inline-flex items-center gap-1 tabular-nums" title={t('{window}: {points} points', { window: windowLabel(u.window, u.label), points: u.deltaPct.toFixed(2) })}>
          {t('{window} +{points} pts', { window: t(SHORT[u.window] as string), points: u.deltaPct < 0.1 && u.deltaPct > 0 ? '<0.1' : u.deltaPct.toFixed(1) })}
          <LimitBadge badge={u.badge} />
        </span>
      ))}
    </span>
  )
}
