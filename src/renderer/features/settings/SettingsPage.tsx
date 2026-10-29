import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/utils'
import { PricesSection } from './PricesSection'
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

const THEMES: Array<{ value: Settings['appearance']['theme']; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

export function SettingsPage() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  const numberField = (path: 'editor.fontSize' | 'terminal.fontSize', value: number) => (
    <Input
      type="number"
      min={9}
      max={32}
      className="h-8 w-20"
      value={value}
      onChange={(e) => {
        const value = Number(e.target.value)
        if (Number.isInteger(value) && value >= 9 && value <= 32) void update(path, value)
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
                  onClick={() => void update('appearance.theme', t.value)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs transition-colors',
                    settings.appearance.theme === t.value
                      ? 'bg-background font-medium text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Editor font size">{numberField('editor.fontSize', settings.editor.fontSize)}</Row>
          <Row label="Terminal font size">{numberField('terminal.fontSize', settings.terminal.fontSize)}</Row>
          <Row label="Terminal shell" hint="Leave empty to use pwsh, falling back to Windows PowerShell.">
            <Input
              className="h-8 w-64 font-mono text-xs"
              placeholder="auto"
              defaultValue={settings.terminal.shell}
              onBlur={(e) => void update('terminal.shell', e.target.value.trim())}
            />
          </Row>
          <Row label="Claude Code executable" hint="Leave empty to use the one bundled with Atelier.">
            <Input
              className="h-8 w-64 font-mono text-xs"
              placeholder="bundled"
              defaultValue={settings.cli.claudeCodePath}
              onBlur={(e) => void update('cli.claudeCodePath', e.target.value.trim())}
            />
          </Row>
          <Row label="Codex executable" hint="Leave empty to use codex from PATH (npm install -g @openai/codex).">
            <Input
              className="h-8 w-64 font-mono text-xs"
              placeholder="from PATH"
              defaultValue={settings.cli.codexPath}
              onBlur={(e) => void update('cli.codexPath', e.target.value.trim())}
            />
          </Row>
          <Row label="Antigravity executable" hint="Leave empty to use agy from PATH or ~/.local/bin.">
            <Input
              className="h-8 w-64 font-mono text-xs"
              placeholder="from PATH"
              defaultValue={settings.cli.antigravityPath}
              onBlur={(e) => void update('cli.antigravityPath', e.target.value.trim())}
            />
          </Row>
        </section>
        <PricesSection />
      </div>
    </div>
  )
}
