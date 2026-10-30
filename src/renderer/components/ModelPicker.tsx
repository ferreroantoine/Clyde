import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, Check, ChevronDown, CircleAlert, RefreshCw, Sparkles } from 'lucide-react'
import { t } from '@shared/i18n'
import { EFFORT_LABELS, findModel, type ModelOption, type ReasoningEffort } from '@shared/profiles'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/Skeleton'
import { useModels } from '@/stores/models'
import { cn } from '@/lib/utils'

export interface ModelChoice {
  model: string
  effort: ReasoningEffort | ''
}

/** The account's models, listed once; `null` while there is no account. */
export function useModelList(profileId: string | null | undefined) {
  const list = useModels((s) => (profileId ? s.lists[profileId] : undefined))
  const load = useModels((s) => s.load)
  useEffect(() => {
    if (profileId) void load(profileId)
  }, [profileId, load])
  return { models: list?.models ?? [], loading: list?.loading ?? !!profileId, error: list?.error ?? null, refresh: () => profileId && load(profileId, true) }
}

/** An effort still valid for this model, else the model's default. */
export function keepEffort(models: readonly ModelOption[], model: string, effort: ReasoningEffort | ''): ReasoningEffort | '' {
  return effort && findModel(models, model)?.efforts?.includes(effort) ? effort : ''
}

/**
 * Model and reasoning effort for an account: a searchable list of what the account offers (from
 * its API or CLI), the default, and any id typed by hand; then the effort levels that model takes.
 */
export function ModelPicker({
  profileId,
  value,
  onChange,
  defaultLabel,
  className
}: {
  profileId: string | null | undefined
  value: ModelChoice
  onChange: (value: ModelChoice) => void
  /** What "Default" means here, e.g. the account's default model. */
  defaultLabel?: string
  className?: string
}) {
  const { models, loading, error, refresh } = useModelList(profileId)
  const current = findModel(models, value.model)
  const efforts = current?.efforts ?? []
  const pick = (model: string) => onChange({ model, effort: keepEffort(models, model, value.effort) })
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      <ModelMenu
        models={models}
        loading={loading}
        error={error}
        value={value.model}
        current={current}
        defaultLabel={defaultLabel}
        onPick={pick}
        onRefresh={() => void refresh()}
      />
      {efforts.length > 0 && (
        <EffortMenu efforts={efforts} fallback={current?.defaultEffort} value={value.effort} onChange={(effort) => onChange({ ...value, effort })} />
      )}
    </div>
  )
}

function ModelMenu({
  models,
  loading,
  error,
  value,
  current,
  defaultLabel,
  onPick,
  onRefresh
}: {
  models: ModelOption[]
  loading: boolean
  error: string | null
  value: string
  current: ModelOption | undefined
  defaultLabel: string | undefined
  onPick: (model: string) => void
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () => models.filter((m) => !q || m.value.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)),
    [models, q]
  )
  // Rows: the default, the listed models, and the typed id when it is not one of them.
  const custom = q && !models.some((m) => m.value.toLowerCase() === q) ? query.trim() : null
  const rows: Array<{ key: string; model: string }> = [
    ...(q ? [] : [{ key: '\u0000default', model: '' }]),
    ...shown.map((m) => ({ key: m.value, model: m.value })),
    ...(custom ? [{ key: '\u0000custom', model: custom }] : [])
  ]
  const choose = (model: string) => {
    onPick(model)
    setOpen(false)
    setQuery('')
  }
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const label = value ? (current?.displayName ?? value) : defaultLabel ? t('Default ({model})', { model: defaultLabel }) : t('Default model')
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setCursor(0)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('Model')}
          className="press flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs shadow-xs hover:bg-accent/60"
        >
          <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{label}</span>
          {value && current && current.displayName !== value && <span className="hidden truncate font-mono text-[10px] text-muted-foreground sm:inline">{value}</span>}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-1 border-b p-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(rows.length - 1, c + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const row = rows[cursor]
                if (row) choose(row.model)
              }
            }}
            placeholder={t('Search or type a model id')}
            aria-label={t('Search models')}
            className="h-7 min-w-0 flex-1 rounded-sm bg-transparent px-2 text-xs outline-none"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={onRefresh}
            title={t('Refresh the list')}
            aria-label={t('Refresh the list')}
            className="grid size-7 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </button>
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1" role="listbox" aria-label={t('Models')}>
          {rows.map((row, i) => {
            const m = models.find((x) => x.value === row.model)
            const selected = row.model === value
            const isDefaultRow = row.key === '\u0000default'
            const isCustom = row.key === '\u0000custom'
            return (
              <button
                key={row.key}
                type="button"
                role="option"
                aria-selected={selected}
                data-row={i}
                onMouseMove={() => setCursor(i)}
                onClick={() => choose(row.model)}
                className={cn('flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left', i === cursor && 'bg-accent')}
              >
                <Check className={cn('mt-0.5 size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="truncate font-medium">
                      {isDefaultRow ? t('Default model') : isCustom ? t('Use “{model}”', { model: row.model }) : (m?.displayName ?? row.model)}
                    </span>
                    {m?.isDefault && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{t('default')}</span>}
                    {m?.efforts?.length ? <Brain className="size-3 shrink-0 text-muted-foreground" aria-label={t('Reasoning effort can be set')} /> : null}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {isDefaultRow
                      ? (defaultLabel ?? t('Chosen by the account or the CLI'))
                      : isCustom
                        ? t('A model id the list does not show')
                        : [m && m.displayName !== m.value ? m.value : '', m?.description].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            )
          })}
          {loading && models.length === 0 && (
            <div className="space-y-1.5 p-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          {!loading && models.length === 0 && !error && <p className="px-2 py-2 text-[11px] text-muted-foreground">{t('This account lists no model; type an id above.')}</p>}
          {error && (
            <p className="flex items-start gap-1.5 px-2 py-2 text-[11px] text-muted-foreground">
              <CircleAlert className="mt-px size-3 shrink-0 text-warning" />
              <span>{t('Could not list the models: {error}', { error })}</span>
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** The reasoning effort, among the levels the model takes; "Default" leaves it to the model. */
export function EffortMenu({
  efforts,
  fallback,
  value,
  onChange
}: {
  efforts: readonly ReasoningEffort[]
  fallback?: ReasoningEffort | undefined
  value: ReasoningEffort | ''
  onChange: (effort: ReasoningEffort | '') => void
}) {
  const label = value ? t(EFFORT_LABELS[value]) : fallback ? t('Default ({level})', { level: t(EFFORT_LABELS[fallback]).toLowerCase() }) : t('Default')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('Reasoning effort')}
          title={t('Reasoning effort')}
          className="press flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs shadow-xs hover:bg-accent/60"
        >
          <Brain className="size-3.5 text-muted-foreground" />
          <span className={cn(!value && 'text-muted-foreground')}>{label}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          {t('More effort thinks longer: better on hard tasks, slower, and more tokens.')}
        </DropdownMenuLabel>
        {(['', ...efforts] as const).map((level) => (
          <DropdownMenuItem key={level || 'default'} onSelect={() => onChange(level)}>
            <Check className={cn('size-3.5', value === level ? 'opacity-100' : 'opacity-0')} />
            <span className="flex-1">{level ? t(EFFORT_LABELS[level]) : t('Default')}</span>
            {!level && fallback && <span className="text-[11px] text-muted-foreground">{t(EFFORT_LABELS[fallback])}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
