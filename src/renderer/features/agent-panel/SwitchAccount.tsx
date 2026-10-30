import { useEffect, useState } from 'react'
import { intlLocale, t } from '@shared/i18n'
import { ArrowLeftRight, Clock, Gauge, X } from 'lucide-react'
import { PROFILE_KIND_LABELS } from '@shared/profiles'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ModelPicker, type ModelChoice } from '@/components/ModelPicker'
import { ProfileBadge } from '@/components/ProfileBadge'
import type { SessionView } from '@/lib/transcript'
import { ENDED_STATUSES, useAgents } from '@/stores/agents'
import { useProfiles } from '@/stores/profiles'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/utils'

const time = (ms: number) => new Date(ms).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })

/** "in 2 h 05", "in 12 min", "in less than a minute". */
function until(ms: number, now: number): string {
  const minutes = Math.ceil((ms - now) / 60_000)
  if (minutes <= 1) return t('in less than a minute')
  if (minutes < 60) return t('in {minutes} min', { minutes })
  return t('in {hours} h {minutes}', { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, '0') })
}

/** Re-renders every half minute, for countdowns. */
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** Moves the session to another account, model or reasoning effort; it keeps its id and transcript. */
export function SwitchDialog({ view, open, onOpenChange }: { view: SessionView; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted on each opening, so it starts from the session as it is then. */}
        <SwitchForm view={view} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function SwitchForm({ view, onDone }: { view: SessionView; onDone: () => void }) {
  const profiles = useProfiles((s) => s.profiles).filter((p) => p.usable)
  const switchAccount = useAgents((s) => s.switchAccount)
  const switching = useAgents((s) => s.resuming === view.info.id)
  const [profileId, setProfileId] = useState(view.info.profileId)
  const [choice, setChoice] = useState<ModelChoice>({ model: view.info.model, effort: view.info.effort })
  // After a limit, or when the session was cut, the agent most likely has something to finish.
  const [carryOn, setCarryOn] = useState(!!view.limit || view.info.status === 'interrupted')
  const selected = profiles.find((p) => p.id === profileId) ?? profiles[0]

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!selected) return
        void switchAccount(view.info.id, { profileId: selected.id, model: choice.model, effort: choice.effort, carryOn }).then((ok) => ok && onDone())
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('Switch account or model')}</DialogTitle>
        <DialogDescription>
          {t('The session goes on in the same thread. Between two Claude Code accounts, or to an API account, the agent keeps the whole conversation; otherwise it gets the end of it.')}
        </DialogDescription>
      </DialogHeader>
      <fieldset className="max-h-56 space-y-1.5 overflow-y-auto">
        <legend className="mb-1.5 text-xs font-medium">{t('Account')}</legend>
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={selected?.id === p.id}
            onClick={() => {
              setProfileId(p.id)
              if (p.id !== profileId) setChoice({ model: '', effort: '' })
            }}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
              selected?.id === p.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
            )}
          >
            <ProfileBadge profile={p} className="font-medium" />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {p.id === view.info.profileId ? t('current') : PROFILE_KIND_LABELS[p.kind]}
            </span>
          </button>
        ))}
      </fieldset>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium">{t('Model and reasoning')}</span>
        <ModelPicker profileId={selected?.id} value={choice} onChange={setChoice} {...(selected?.defaultModel ? { defaultLabel: selected.defaultModel } : {})} />
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={carryOn} onChange={(e) => setCarryOn(e.target.checked)} className="accent-[var(--primary)]" />
        {t('Tell the agent to carry on with its task')}
      </label>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('Cancel')}
        </Button>
        <Button type="submit" loading={switching} disabled={!selected}>
          <ArrowLeftRight /> {t('Switch')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * The account hit its usage limit: when it resets, and the ways out (another account, wait for the
 * reset, or nothing). A planned resume shows here too, with a way to cancel it.
 */
export function LimitBar({ view, onSwitch }: { view: SessionView; onSwitch: () => void }) {
  const id = view.info.id
  const at = useAgents((s) => s.scheduled[id])
  const scheduleResume = useAgents((s) => s.scheduleResume)
  const cancelResume = useAgents((s) => s.cancelResume)
  const switchAccount = useAgents((s) => s.switchAccount)
  const switching = useAgents((s) => s.resuming === id)
  const fallbackIds = useSettings((s) => s.settings.agents.fallbackProfiles)
  const profiles = useProfiles((s) => s.profiles)
  const [dismissed, setDismissed] = useState<number | null | undefined>(undefined)
  const now = useNow()
  const limit = view.limit
  const busy = !ENDED_STATUSES.has(view.info.status) && view.info.status !== 'idle'

  if (at === undefined && (!limit || dismissed === limit.resetsAt || busy)) return null
  const fallback = fallbackIds.map((fid) => profiles.find((p) => p.id === fid)).find((p) => p && p.usable && p.id !== view.info.profileId)
  const resetsAt = limit?.resetsAt && limit.resetsAt > now ? limit.resetsAt : null

  return (
    <div
      className={cn('flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[11px]', at !== undefined ? 'bg-warning/10' : 'bg-destructive/10')}
      data-testid="limit-bar"
    >
      {at !== undefined ? <Clock className="size-3.5 shrink-0" /> : <Gauge className="size-3.5 shrink-0 text-destructive" />}
      <span className="min-w-[12rem] flex-1">
        {at !== undefined
          ? t('Clyde tells the agent to carry on at {time} ({when}).', { time: time(at), when: until(at, now) })
          : resetsAt
            ? t('Usage limit reached. It resets at {time} ({when}).', { time: time(resetsAt), when: until(resetsAt, now) })
            : t('Usage limit reached.')}
      </span>
      {at !== undefined ? (
        <Button size="xs" variant="ghost" onClick={() => void cancelResume(id)}>
          <X /> {t('Cancel')}
        </Button>
      ) : (
        <>
          {fallback ? (
            <Button
              size="xs"
              loading={switching}
              onClick={() => void switchAccount(id, { profileId: fallback.id, model: '', effort: '', carryOn: true })}
            >
              <ArrowLeftRight /> {t('Switch to {name}', { name: fallback.name })}
            </Button>
          ) : (
            <Button size="xs" onClick={onSwitch}>
              <ArrowLeftRight /> {t('Switch account…')}
            </Button>
          )}
          <Button size="xs" variant="outline" onClick={() => void scheduleResume(id)}>
            <Clock /> {resetsAt ? t('Wait and resume at {time}', { time: time(resetsAt + 60_000) }) : t('Wait and resume')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDismissed(limit?.resetsAt ?? null)}>
            {t('Do nothing')}
          </Button>
        </>
      )}
    </div>
  )
}
