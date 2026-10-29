import { useMemo, useState } from 'react'
import { RotateCcw, Search, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { useLayout } from '@/stores/layout'
import { notify } from '@/stores/notifications'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/utils'
import { Row } from './controls'
import { matches, SECTIONS, type Ctx, type Entry, type SectionSpec } from './sections'

function EntryView({ entry, ctx }: { entry: Entry; ctx: Ctx }) {
  if (entry.block) {
    return (
      <div className="border-b py-3.5 last:border-b-0" data-setting={entry.id}>
        {entry.block(ctx)}
      </div>
    )
  }
  return (
    <Row id={entry.id} label={entry.label} {...(entry.hint ? { hint: entry.hint } : {})}>
      {entry.control?.(ctx)}
    </Row>
  )
}

function SectionView({ section, entries, ctx, searching }: { section: SectionSpec; entries: Entry[]; ctx: Ctx; searching: boolean }) {
  const [resetting, setResetting] = useState(false)
  const reset = async () => {
    if (!section.resets) return
    setResetting(true)
    try {
      useSettings.setState({ settings: await invoke('settings:resetSection', { section: section.resets }) })
      notify.success(t('{section} reset to defaults', { section: t(section.label) }))
    } catch (err) {
      notify.error(t('Could not reset the section'), err)
    } finally {
      setResetting(false)
    }
  }
  return (
    <section aria-labelledby={`settings-${section.id}`} className="space-y-2" data-section={section.id}>
      <header className="flex items-center justify-between gap-2">
        <h2 id={`settings-${section.id}`} className={cn('font-semibold tracking-tight', searching ? 'text-sm' : 'text-lg')}>
          {t(section.label)}
        </h2>
        {section.resets && !searching && (
          <Button size="xs" variant="ghost" disabled={resetting} onClick={() => void reset()}>
            <RotateCcw /> {t('Reset section')}
          </Button>
        )}
      </header>
      <div className="rounded-xl border bg-card px-5">
        {entries.map((e) => (
          <EntryView key={e.id} entry={e} ctx={ctx} />
        ))}
      </div>
    </section>
  )
}

/** Settings: a section list, a search across every setting, and changes saved as you make them. */
export function SettingsPage() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const current = useLayout((s) => s.settingsSection)
  const showSettings = useLayout((s) => s.showSettings)
  const [query, setQuery] = useState('')
  const ctx: Ctx = { s: settings, set: (path, value) => void update(path, value) }

  const sections = useMemo(() => SECTIONS.map((s) => ({ section: s, entries: s.entries() })), [])
  const searching = query.trim().length > 0
  const results = searching
    ? sections
        .map(({ section, entries }) => ({ section, entries: entries.filter((e) => matches(e, t(section.label), query)) }))
        .filter((r) => r.entries.length > 0)
    : sections.filter((s) => s.section.id === current)

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-chrome px-2 py-4" aria-label={t('Settings sections')}>
        <h1 className="px-2 pb-2 text-sm font-semibold">{t('Settings')}</h1>
        {sections.map(({ section }) => {
          const Icon = section.icon
          const active = !searching && section.id === current
          return (
            <button
              key={section.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                setQuery('')
                showSettings(section.id)
              }}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{t(section.label)}</span>
            </button>
          )
        })}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder={t('Search settings')}
              aria-label={t('Search settings')}
              className="h-9 pr-8 pl-8"
            />
            {searching && (
              <button
                type="button"
                aria-label={t('Clear the search')}
                onClick={() => setQuery('')}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          {!searching && <p className="-mt-3 text-xs text-muted-foreground">{t('Changes apply and are saved as you make them.')}</p>}
          {results.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('No setting matches “{query}”.', { query: query.trim() })}</p>
          ) : (
            results.map(({ section, entries }) => (
              <SectionView key={section.id} section={section} entries={entries} ctx={ctx} searching={searching} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
