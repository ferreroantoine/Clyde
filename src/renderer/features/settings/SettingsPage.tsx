import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/utils'
import type { Settings } from '@shared/settings'

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b py-4 last:border-b-0">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const THEMES: Array<{ value: Settings['theme']; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

export function SettingsPage() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  const numberField = (key: 'editorFontSize' | 'terminalFontSize') => (
    <Input
      type="number"
      min={9}
      max={32}
      className="h-8 w-20"
      value={settings[key]}
      onChange={(e) => {
        const value = Number(e.target.value)
        if (Number.isInteger(value) && value >= 9 && value <= 32) void update(key, value)
      }}
    />
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-10">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Changes are saved automatically.</p>

        <section className="mt-8 rounded-xl border bg-card px-5">
          <Row label="Theme" hint="System follows the Windows setting.">
            <div className="flex rounded-lg border bg-muted p-0.5">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => void update('theme', t.value)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs transition-colors',
                    settings.theme === t.value
                      ? 'bg-background font-medium text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Editor font size">{numberField('editorFontSize')}</Row>
          <Row label="Terminal font size">{numberField('terminalFontSize')}</Row>
          <Row label="Terminal shell" hint="Leave empty to use pwsh, falling back to Windows PowerShell.">
            <Input
              className="h-8 w-64 font-mono text-xs"
              placeholder="auto"
              defaultValue={settings.terminalShell}
              onBlur={(e) => void update('terminalShell', e.target.value.trim())}
            />
          </Row>
        </section>
      </div>
    </div>
  )
}
