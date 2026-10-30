import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, ExternalLink, FlaskConical, Library, Plus, Trash2 } from 'lucide-react'
import { t, tn } from '@shared/i18n'
import { estimateTokens, type McpPreset, type McpProbe } from '@shared/mcp-catalog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Appear } from '@/components/Appear'
import { PathField } from '@/features/settings/controls'
import { useMcp } from '@/stores/mcp'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'

/** "14 tools · ~3.3k tokens", the context a server costs every agent that gets all its tools. */
export function ContextCost({ tools, chars, className }: { tools: number; chars: number; className?: string }) {
  if (tools === 0) return <span className={cn('text-muted-foreground', className)}>{t('Tools listed after a test')}</span>
  const tokens = estimateTokens(chars)
  return (
    <span className={cn('tabular-nums', tokens > 4000 ? 'text-warning' : 'text-muted-foreground', className)} title={t('Estimated from the size of the tool definitions, about four characters per token.')}>
      {tn('{count} tool', '{count} tools', tools)}
      {chars > 0 && ` · ${t('~{tokens} tokens', { tokens: tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens })}`}
    </span>
  )
}

/** Parameters, a test run and the install, for one preset. */
function InstallDialog({ preset, onClose }: { preset: McpPreset | null; onClose: () => void }) {
  const workspace = useWorkspace((s) => s.info)
  const install = useMcp((s) => s.installPreset)
  const test = useMcp((s) => s.test)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((preset?.params ?? []).map((p) => [p.key, p.defaultValue === 'workspace' ? (workspace?.root ?? '') : '']))
  )
  const [probe, setProbe] = useState<McpProbe | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  if (!preset) return null
  const missing = preset.params.some((p) => p.required && !values[p.key]?.trim())

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Add {name}', { name: t(preset.title) })}</DialogTitle>
          <DialogDescription>{t(preset.description)}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (missing) return
            setSaving(true)
            void install(preset.id, values)
              .then((ok) => ok && onClose())
              .finally(() => setSaving(false))
          }}
        >
          {preset.params.map((p) => (
            <label key={p.key} className="grid gap-1.5">
              <span className="text-xs font-medium">
                {t(p.label)}
                {!p.required && <span className="font-normal text-muted-foreground"> · {t('optional')}</span>}
              </span>
              {p.kind === 'folder' || p.kind === 'file' ? (
                <PathField kind={p.kind} label={t(p.label)} value={values[p.key] ?? ''} onChange={(v) => setValues({ ...values, [p.key]: v })} />
              ) : (
                <Input
                  type={p.kind === 'secret' ? 'password' : 'text'}
                  autoComplete="off"
                  value={values[p.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
                  aria-label={t(p.label)}
                />
              )}
              {p.hint && <span className="text-[11px] text-muted-foreground">{t(p.hint)}</span>}
            </label>
          ))}
          <p className="text-[11px] text-muted-foreground">
            {preset.transport === 'stdio' ? (
              <span className="font-mono">
                {preset.command} {preset.args.join(' ')}
              </span>
            ) : (
              <span className="font-mono">{preset.url}</span>
            )}
            {preset.requires && <span className="block">{t('Needs: {what}', { what: t(preset.requires) })}</span>}
          </p>
          {probe && (
            <div className={cn('rounded-lg border px-3 py-2 text-xs', probe.ok ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5')} role="status">
              {probe.ok ? (
                <>
                  <p className="flex items-center gap-1.5 font-medium text-success">
                    <CircleCheck className="size-3.5" /> {t('It starts.')}{' '}
                    <ContextCost tools={probe.tools.length} chars={probe.tools.reduce((n, x) => n + x.chars, 0)} className="font-normal" />
                  </p>
                  <p className="mt-1 line-clamp-3 font-mono text-[11px] text-muted-foreground">{probe.tools.map((x) => x.name).join(', ')}</p>
                </>
              ) : (
                <p className="flex items-start gap-1.5 text-destructive">
                  <CircleAlert className="mt-px size-3.5 shrink-0" /> {probe.error}
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              loading={testing}
              disabled={missing}
              onClick={() => {
                setTesting(true)
                void test({ presetId: preset.id, values })
                  .then(setProbe)
                  .finally(() => setTesting(false))
              }}
            >
              <FlaskConical /> {t('Test')}
            </Button>
            <Button type="submit" loading={saving} disabled={missing}>
              <Plus /> {t('Add server')}
            </Button>
          </DialogFooter>
          <p className="text-[11px] text-muted-foreground">{t('Adding it does not give it to your agents: tick its tools when you start an agent or edit a saved one.')}</p>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Ready-made servers, off until added; the user's own presets after them. */
export function McpCatalog() {
  const presets = useMcp((s) => s.presets)
  const servers = useMcp((s) => s.servers)
  const load = useMcp((s) => s.loadPresets)
  const removePreset = useMcp((s) => s.deletePreset)
  const [installing, setInstalling] = useState<McpPreset | null>(null)
  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="mt-8 space-y-3" aria-label={t('Catalog')}>
      <div className="flex items-center gap-2">
        <Library className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('Catalog')}</h2>
        <span className="text-xs text-muted-foreground">{t('Checked servers, off until you add them.')}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {presets.map((p) => {
          const added = servers.some((s) => s.presetId === p.id)
          return (
            <Appear key={p.id}>
              <article className="flex h-full flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs" aria-label={t(p.title)} data-preset={p.id}>
                <header className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{t(p.title)}</h3>
                    <p className="truncate text-[11px] text-muted-foreground" title={p.publisher}>
                      {p.builtin ? p.publisher : t('Your preset')}
                    </p>
                  </div>
                  {p.source && (
                    <a href={p.source} target="_blank" rel="noreferrer" aria-label={t('Source of {name}', { name: t(p.title) })} className="press shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </header>
                <p className="flex-1 text-xs text-muted-foreground">{t(p.description)}</p>
                <div className="space-y-1 text-[11px]">
                  <ContextCost tools={p.tools.length} chars={p.toolChars} />
                  {p.params.length > 0 && (
                    <p className="text-muted-foreground">{t('Asks for: {list}', { list: p.params.map((x) => t(x.label)).join(', ') })}</p>
                  )}
                  {p.requires && <p className="text-muted-foreground">{t('Needs: {what}', { what: t(p.requires) })}</p>}
                </div>
                <footer className="flex items-center gap-2">
                  {added ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success">
                      <CircleCheck className="size-3.5" /> {t('Added')}
                    </span>
                  ) : (
                    <Button size="xs" onClick={() => setInstalling(p)}>
                      <Plus /> {t('Add')}
                    </Button>
                  )}
                  {!p.builtin && (
                    <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label={t('Delete {name}', { name: p.title })} onClick={() => void removePreset(p.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </footer>
              </article>
            </Appear>
          )
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('Not offered: SQLite. Its reference server was archived and nothing maintained replaces it.')}</p>
      {installing && <InstallDialog key={installing.id} preset={installing} onClose={() => setInstalling(null)} />}
    </section>
  )
}
