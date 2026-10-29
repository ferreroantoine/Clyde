import { useState } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { comboOf, effectiveBindings, findConflicts, formatCombo, isModifierOnly, KEY_COMMANDS } from '@shared/keybindings'
import { t } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/utils'

/** Every window shortcut, editable: click, press the new keys; Escape cancels, Backspace removes. */
export function ShortcutsEditor() {
  const overrides = useSettings((s) => s.settings.shortcuts.bindings)
  const update = useSettings((s) => s.update)
  const [recording, setRecording] = useState<string | null>(null)
  const bindings = effectiveBindings(overrides)
  const conflicts = findConflicts(bindings)
  const labelOf = (id: string) => t(KEY_COMMANDS.find((c) => c.id === id)?.label ?? id)

  const save = (id: string, combo: string | null) => {
    const spec = KEY_COMMANDS.find((c) => c.id === id)
    const next = Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id))
    if (combo !== null && combo !== spec?.defaultCombo) next[id] = combo
    void update('shortcuts.bindings', next)
  }

  return (
    <div className="divide-y rounded-lg border">
      {KEY_COMMANDS.map((c) => {
        const combo = bindings[c.id] ?? ''
        const mine = conflicts.filter((x) => x.commandId === c.id)
        const changed = c.id in overrides
        return (
          <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2" data-command={c.id}>
            <span className="min-w-0 flex-1 text-sm">{t(c.label)}</span>
            {mine.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-warning" role="status">
                <TriangleAlert className="size-3.5" />
                {mine
                  .map((x) => (x.with.kind === 'command' ? t('Also used by: {name}', { name: labelOf(x.with.id) }) : t('Hides the editor’s {action}', { action: t(x.with.action) })))
                  .join(' · ')}
              </span>
            )}
            <button
              type="button"
              aria-label={t('Shortcut for {name}', { name: t(c.label) })}
              onClick={() => setRecording(c.id)}
              onBlur={() => setRecording((r) => (r === c.id ? null : r))}
              onKeyDown={(e) => {
                if (recording !== c.id) return
                e.preventDefault()
                e.stopPropagation()
                if (e.key === 'Escape') return setRecording(null)
                if (e.key === 'Backspace' || e.key === 'Delete') {
                  save(c.id, '')
                  return setRecording(null)
                }
                const next = comboOf(e.nativeEvent)
                if (isModifierOnly(next)) return
                save(c.id, next)
                setRecording(null)
              }}
              className={cn(
                'min-w-28 rounded-md border px-2 py-1 text-center font-mono text-xs transition-colors',
                recording === c.id ? 'border-primary bg-primary/5 text-primary' : 'hover:bg-accent',
                !combo && recording !== c.id && 'text-muted-foreground'
              )}
            >
              {recording === c.id ? t('Press keys…') : combo ? formatCombo(combo) : t('None')}
            </button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t('Restore the default')}
              title={formatCombo(c.defaultCombo)}
              disabled={!changed}
              onClick={() => save(c.id, null)}
            >
              <RotateCcw />
            </Button>
          </div>
        )
      })}
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        {t('Click a shortcut, then press the new keys. Escape cancels, Backspace removes it. The editor and terminals keep their own keys when focused.')}
      </p>
    </div>
  )
}
