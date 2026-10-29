import type { ReactNode } from 'react'
import {
  Bell,
  Bot,
  Code,
  Database,
  Gauge,
  Info,
  KeyRound,
  Keyboard,
  Palette,
  Plug,
  Settings2,
  SquareTerminal,
  type LucideIcon
} from 'lucide-react'
import { PERMISSION_LEVELS, PERMISSION_LEVEL_LABELS } from '@shared/agent'
import { t, tk } from '@shared/i18n'
import { ACCENTS, type SettingPath, type Settings, type SettingValue } from '@shared/settings'
import type { SettingsSection } from '@/stores/layout'
import { NumberField, PathField, Segmented, Select, TextField, Toggle } from './controls'
import { AccountsPage } from '@/features/accounts/AccountsPage'
import { McpPage } from '@/features/mcp/McpPage'
import { PricesSection } from './PricesSection'
import { ShortcutsEditor } from './ShortcutsEditor'
import { DataBlock } from './DataBlock'
import { AboutBlock } from './AboutBlock'

export interface Ctx {
  s: Settings
  set: <P extends SettingPath>(path: P, value: SettingValue<P>) => void
}

export interface Entry {
  id: string
  label: string
  hint?: string
  /** Extra words the search matches. */
  keywords?: string
  /** A control shown on the right of a row; `block` entries take the whole width instead. */
  control?: (ctx: Ctx) => ReactNode
  block?: (ctx: Ctx) => ReactNode
}

export interface SectionSpec {
  id: SettingsSection
  label: string
  icon: LucideIcon
  /** The settings section reset by "Reset section", when the section stores settings. */
  resets?: keyof Settings
  entries: () => Entry[]
}

const ACCENT_LABELS: Record<(typeof ACCENTS)[number], string> = {
  indigo: tk('Indigo'),
  blue: tk('Blue'),
  teal: tk('Teal'),
  green: tk('Green'),
  orange: tk('Orange'),
  rose: tk('Rose'),
  violet: tk('Violet'),
  slate: tk('Slate')
}

/** Accent swatches, painted with the same tokens the app uses. */
const ACCENT_SWATCH: Record<(typeof ACCENTS)[number], string> = {
  indigo: 'oklch(0.52 0.19 268)',
  blue: 'oklch(0.52 0.17 250)',
  teal: 'oklch(0.55 0.11 190)',
  green: 'oklch(0.55 0.15 150)',
  orange: 'oklch(0.55 0.17 50)',
  rose: 'oklch(0.52 0.19 10)',
  violet: 'oklch(0.52 0.2 300)',
  slate: 'oklch(0.52 0.035 260)'
}

const SHELLS = [
  { value: '', label: tk('Automatic (PowerShell 7, else Windows PowerShell)') },
  { value: 'pwsh.exe', label: tk('PowerShell 7') },
  { value: 'powershell.exe', label: tk('Windows PowerShell') },
  { value: 'cmd.exe', label: tk('Command Prompt') },
  { value: 'C:\\Program Files\\Git\\bin\\bash.exe', label: tk('Git Bash') },
  { value: 'wsl.exe', label: tk('WSL') }
]

function ShellControl({ s, set }: Ctx) {
  const preset = SHELLS.find((o) => o.value === s.terminal.shell)
  return (
    <span className="flex flex-col items-end gap-1.5">
      <Select
        label={t('Default shell')}
        value={preset ? preset.value : 'custom'}
        options={[...SHELLS.map((o) => ({ value: o.value, label: t(o.label) })), { value: 'custom', label: t('Other program…') }]}
        onChange={(v) => v !== 'custom' && set('terminal.shell', v)}
      />
      {!preset && <PathField kind="file" label={t('Shell program')} value={s.terminal.shell} onChange={(v) => set('terminal.shell', v)} />}
    </span>
  )
}

/** "75, 90" ↔ [75, 90]. */
function ThresholdsField({ value, onChange, label }: { value: number[]; onChange: (v: number[]) => void; label: string }) {
  return (
    <TextField
      label={label}
      mono={false}
      className="w-28 text-right tabular-nums"
      value={value.join(', ')}
      onChange={(text) => {
        const list = [...new Set(text.split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 100))].sort((a, b) => a - b)
        onChange(list.slice(0, 5))
      }}
    />
  )
}

export const SECTIONS: SectionSpec[] = [
  {
    id: 'general',
    label: tk('General'),
    icon: Settings2,
    resets: 'general',
    entries: () => [
      {
        id: 'general.language',
        label: t('Language'),
        keywords: 'langue english français french',
        control: ({ s, set }) => (
          <Select
            label={t('Language')}
            value={s.general.language}
            options={[
              { value: 'system', label: t('Same as the system') },
              { value: 'en', label: tk('English') },
              { value: 'fr', label: tk('Français') }
            ]}
            onChange={(v) => set('general.language', v)}
          />
        )
      },
      {
        id: 'general.startView',
        label: t('Start view'),
        hint: t('What Atelier shows when it starts.'),
        control: ({ s, set }) => (
          <Select
            label={t('Start view')}
            value={s.general.startView}
            options={[
              { value: 'chat', label: t('Chat') },
              { value: 'editor', label: t('Explorer') },
              { value: 'agents', label: t('Agents') },
              { value: 'supervision', label: t('Supervision') }
            ]}
            onChange={(v) => set('general.startView', v)}
          />
        )
      },
      {
        id: 'general.reopenLastProject',
        label: t('Open the last project at startup'),
        control: ({ s, set }) => (
          <Toggle label={t('Open the last project at startup')} checked={s.general.reopenLastProject} onChange={(v) => set('general.reopenLastProject', v)} />
        )
      },
      {
        id: 'general.projectsFolder',
        label: t('Default projects folder'),
        hint: t('Where "Open folder" starts.'),
        control: ({ s, set }) => (
          <PathField label={t('Default projects folder')} placeholder={t('Home folder')} value={s.general.projectsFolder} onChange={(v) => set('general.projectsFolder', v)} />
        )
      },
      {
        id: 'general.closeBehavior',
        label: t('When the window is closed'),
        keywords: 'tray system tray minimize quit',
        control: ({ s, set }) => (
          <Segmented
            label={t('When the window is closed')}
            value={s.general.closeBehavior}
            options={[
              { value: 'quit', label: t('Quit') },
              { value: 'tray', label: t('Keep in the system tray') }
            ]}
            onChange={(v) => set('general.closeBehavior', v)}
          />
        )
      }
    ]
  },
  {
    id: 'appearance',
    label: tk('Appearance'),
    icon: Palette,
    resets: 'appearance',
    entries: () => [
      {
        id: 'appearance.theme',
        label: t('Theme'),
        hint: t('System follows the Windows setting.'),
        keywords: 'dark light',
        control: ({ s, set }) => (
          <Segmented
            label={t('Theme')}
            value={s.appearance.theme}
            options={[
              { value: 'light', label: t('Light') },
              { value: 'dark', label: t('Dark') },
              { value: 'system', label: t('System') }
            ]}
            onChange={(v) => set('appearance.theme', v)}
          />
        )
      },
      {
        id: 'appearance.accent',
        label: t('Accent color'),
        keywords: 'color colour',
        control: ({ s, set }) => (
          <span className="flex gap-1.5" role="radiogroup" aria-label={t('Accent color')}>
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={s.appearance.accent === a}
                aria-label={t(ACCENT_LABELS[a])}
                title={t(ACCENT_LABELS[a])}
                onClick={() => set('appearance.accent', a)}
                className="press size-6 rounded-full ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                style={{
                  backgroundColor: ACCENT_SWATCH[a],
                  boxShadow: s.appearance.accent === a ? `0 0 0 2px var(--background), 0 0 0 4px ${ACCENT_SWATCH[a]}` : undefined
                }}
              />
            ))}
          </span>
        )
      },
      {
        id: 'appearance.density',
        label: t('Density'),
        hint: t('Compact fits more on screen.'),
        control: ({ s, set }) => (
          <Segmented
            label={t('Density')}
            value={s.appearance.density}
            options={[
              { value: 'compact', label: t('Compact') },
              { value: 'comfortable', label: t('Comfortable') }
            ]}
            onChange={(v) => set('appearance.density', v)}
          />
        )
      },
      {
        id: 'appearance.uiFontSize',
        label: t('Interface text size'),
        hint: t('Scales the whole window; 13 is the default.'),
        keywords: 'zoom font scale',
        control: ({ s, set }) => (
          <NumberField label={t('Interface text size')} min={11} max={18} suffix="px" value={s.appearance.uiFontSize} onChange={(v) => set('appearance.uiFontSize', v)} />
        )
      },
      {
        id: 'appearance.animations',
        label: t('Animations'),
        hint: t('Reduced keeps fades only. The system "reduce motion" setting always applies.'),
        keywords: 'motion',
        control: ({ s, set }) => (
          <Segmented
            label={t('Animations')}
            value={s.appearance.animations}
            options={[
              { value: 'full', label: t('Full') },
              { value: 'reduced', label: t('Reduced') },
              { value: 'off', label: t('Off') }
            ]}
            onChange={(v) => set('appearance.animations', v)}
          />
        )
      }
    ]
  },
  {
    id: 'accounts',
    label: tk('Accounts & providers'),
    icon: KeyRound,
    resets: 'cli',
    entries: () => [
      {
        id: 'accounts.list',
        label: t('Accounts'),
        keywords: 'profiles claude chatgpt codex gemini antigravity ollama openai anthropic api key login sign in',
        block: () => <AccountsPage embedded />
      },
      {
        id: 'cli.claudeCodePath',
        label: t('Claude Code executable'),
        hint: t('Leave empty to use the one bundled with Atelier.'),
        control: ({ s, set }) => (
          <PathField kind="file" label={t('Claude Code executable')} placeholder={t('bundled')} value={s.cli.claudeCodePath} onChange={(v) => set('cli.claudeCodePath', v)} />
        )
      },
      {
        id: 'cli.codexPath',
        label: t('Codex executable'),
        hint: t('Leave empty to use codex from PATH (npm install -g @openai/codex).'),
        control: ({ s, set }) => (
          <PathField kind="file" label={t('Codex executable')} placeholder={t('from PATH')} value={s.cli.codexPath} onChange={(v) => set('cli.codexPath', v)} />
        )
      },
      {
        id: 'cli.antigravityPath',
        label: t('Antigravity executable'),
        hint: t('Leave empty to use agy from PATH or ~/.local/bin.'),
        control: ({ s, set }) => (
          <PathField kind="file" label={t('Antigravity executable')} placeholder={t('from PATH')} value={s.cli.antigravityPath} onChange={(v) => set('cli.antigravityPath', v)} />
        )
      }
    ]
  },
  {
    id: 'agents',
    label: tk('Agents'),
    icon: Bot,
    resets: 'agents',
    entries: () => [
      {
        id: 'agents.defaultPermission',
        label: t('Default permission level'),
        hint: t('Preselected for new sessions and saved agents.'),
        control: ({ s, set }) => (
          <Select
            label={t('Default permission level')}
            value={s.agents.defaultPermission}
            options={PERMISSION_LEVELS.map((l) => ({ value: l, label: t(PERMISSION_LEVEL_LABELS[l]) }))}
            onChange={(v) => set('agents.defaultPermission', v)}
          />
        )
      },
      {
        id: 'agents.defaultModel',
        label: t('Default model'),
        hint: t('Used when neither the agent nor its account sets one. It must exist for that provider.'),
        control: ({ s, set }) => (
          <TextField label={t('Default model')} placeholder={t('provider default')} value={s.agents.defaultModel} onChange={(v) => set('agents.defaultModel', v)} />
        )
      },
      {
        id: 'agents.maxParallel',
        label: t('Agents running at once'),
        hint: t('More agents use more memory and CPU, and share the plan limits of their accounts.'),
        keywords: 'parallel concurrent maximum',
        control: ({ s, set }) => (
          <NumberField label={t('Agents running at once')} min={1} max={16} value={s.agents.maxParallel} onChange={(v) => set('agents.maxParallel', v)} />
        )
      },
      {
        id: 'agents.worktreesFolder',
        label: t('Worktrees folder'),
        hint: t('Where board tasks get their git worktree. Empty means %LOCALAPPDATA%\\Atelier\\worktrees.'),
        control: ({ s, set }) => (
          <PathField label={t('Worktrees folder')} placeholder={t('default')} value={s.agents.worktreesFolder} onChange={(v) => set('agents.worktreesFolder', v)} />
        )
      },
      {
        id: 'agents.deleteMergedWorktrees',
        label: t('Delete worktrees once merged'),
        hint: t('Removes the folder and the task branch after a successful merge.'),
        control: ({ s, set }) => (
          <Toggle label={t('Delete worktrees once merged')} checked={s.agents.deleteMergedWorktrees} onChange={(v) => set('agents.deleteMergedWorktrees', v)} />
        )
      }
    ]
  },
  {
    id: 'usage',
    label: tk('Usage & limits'),
    icon: Gauge,
    resets: 'usage',
    entries: () => [
      {
        id: 'usage.fiveHourAlerts',
        label: t('Alerts for the 5-hour window'),
        hint: t('Percentages, separated by commas. A toast and a desktop notification, once per window.'),
        keywords: 'threshold limit notification',
        control: ({ s, set }) => (
          <ThresholdsField label={t('Alerts for the 5-hour window')} value={s.usage.fiveHourAlerts} onChange={(v) => set('usage.fiveHourAlerts', v)} />
        )
      },
      {
        id: 'usage.sevenDayAlerts',
        label: t('Alerts for the weekly window'),
        keywords: 'threshold limit notification',
        control: ({ s, set }) => (
          <ThresholdsField label={t('Alerts for the weekly window')} value={s.usage.sevenDayAlerts} onChange={(v) => set('usage.sevenDayAlerts', v)} />
        )
      },
      {
        id: 'usage.refreshMinutes',
        label: t('Read limits every'),
        hint: t('For accounts with no running agent. Running agents report theirs after each turn.'),
        keywords: 'refresh frequency',
        control: ({ s, set }) => (
          <NumberField label={t('Read limits every')} min={1} max={240} suffix={t('min')} value={s.usage.refreshMinutes} onChange={(v) => set('usage.refreshMinutes', v)} />
        )
      },
      {
        id: 'usage.statusBarGauges',
        label: t('Gauges in the status bar'),
        hint: t('5-hour and weekly use of the active agent’s account.'),
        control: ({ s, set }) => (
          <Toggle label={t('Gauges in the status bar')} checked={s.usage.statusBarGauges} onChange={(v) => set('usage.statusBarGauges', v)} />
        )
      },
      {
        id: 'usage.diagnostic',
        label: t('Diagnostic'),
        hint: t('Supervision › an account › Diagnostic shows what each CLI answered about its limits.'),
        keywords: 'debug sources'
      },
      { id: 'usage.prices', label: t('Prices'), keywords: 'cost price api tokens', block: () => <PricesSection /> }
    ]
  },
  {
    id: 'editor',
    label: tk('Editor'),
    icon: Code,
    resets: 'editor',
    entries: () => [
      {
        id: 'editor.fontFamily',
        label: t('Font'),
        control: ({ s, set }) => <TextField label={t('Font')} value={s.editor.fontFamily} onChange={(v) => set('editor.fontFamily', v)} />
      },
      {
        id: 'editor.fontSize',
        label: t('Font size'),
        control: ({ s, set }) => <NumberField label={t('Font size')} min={9} max={32} suffix="px" value={s.editor.fontSize} onChange={(v) => set('editor.fontSize', v)} />
      },
      {
        id: 'editor.tabSize',
        label: t('Tab size'),
        keywords: 'indent spaces',
        control: ({ s, set }) => <NumberField label={t('Tab size')} min={1} max={8} value={s.editor.tabSize} onChange={(v) => set('editor.tabSize', v)} />
      },
      {
        id: 'editor.wordWrap',
        label: t('Word wrap'),
        control: ({ s, set }) => <Toggle label={t('Word wrap')} checked={s.editor.wordWrap} onChange={(v) => set('editor.wordWrap', v)} />
      },
      {
        id: 'editor.minimap',
        label: t('Minimap'),
        control: ({ s, set }) => <Toggle label={t('Minimap')} checked={s.editor.minimap} onChange={(v) => set('editor.minimap', v)} />
      },
      {
        id: 'editor.formatOnSave',
        label: t('Format on save'),
        hint: t('Uses the formatter Monaco has for the language, when there is one.'),
        control: ({ s, set }) => <Toggle label={t('Format on save')} checked={s.editor.formatOnSave} onChange={(v) => set('editor.formatOnSave', v)} />
      }
    ]
  },
  {
    id: 'terminal',
    label: tk('Terminal'),
    icon: SquareTerminal,
    resets: 'terminal',
    entries: () => [
      { id: 'terminal.shell', label: t('Default shell'), keywords: 'powershell cmd git bash wsl', control: (ctx) => <ShellControl {...ctx} /> },
      {
        id: 'terminal.fontFamily',
        label: t('Font'),
        control: ({ s, set }) => <TextField label={t('Font')} value={s.terminal.fontFamily} onChange={(v) => set('terminal.fontFamily', v)} />
      },
      {
        id: 'terminal.fontSize',
        label: t('Font size'),
        control: ({ s, set }) => <NumberField label={t('Font size')} min={9} max={32} suffix="px" value={s.terminal.fontSize} onChange={(v) => set('terminal.fontSize', v)} />
      },
      {
        id: 'terminal.scrollback',
        label: t('Scrollback'),
        hint: t('Lines each terminal keeps.'),
        control: ({ s, set }) => (
          <NumberField label={t('Scrollback')} min={100} max={100_000} suffix={t('lines')} value={s.terminal.scrollback} onChange={(v) => set('terminal.scrollback', v)} />
        )
      }
    ]
  },
  {
    id: 'mcp',
    label: tk('MCP'),
    icon: Plug,
    entries: () => [
      {
        id: 'mcp.servers',
        label: t('MCP servers'),
        keywords: 'tools servers import claude desktop',
        block: () => <McpPage embedded />
      }
    ]
  },
  {
    id: 'shortcuts',
    label: tk('Keyboard shortcuts'),
    icon: Keyboard,
    resets: 'shortcuts',
    entries: () => [{ id: 'shortcuts.list', label: t('Keyboard shortcuts'), keywords: 'keys bindings hotkeys', block: () => <ShortcutsEditor /> }]
  },
  {
    id: 'notifications',
    label: tk('Notifications'),
    icon: Bell,
    resets: 'notifications',
    entries: () => [
      {
        id: 'notifications.agentDone',
        label: t('When an agent finishes'),
        hint: t('A desktop notification, when Atelier is in the background.'),
        control: ({ s, set }) => (
          <Toggle label={t('When an agent finishes')} checked={s.notifications.agentDone} onChange={(v) => set('notifications.agentDone', v)} />
        )
      },
      {
        id: 'notifications.approvalNeeded',
        label: t('When an agent waits for approval'),
        control: ({ s, set }) => (
          <Toggle label={t('When an agent waits for approval')} checked={s.notifications.approvalNeeded} onChange={(v) => set('notifications.approvalNeeded', v)} />
        )
      },
      {
        id: 'notifications.sounds',
        label: t('Sounds'),
        hint: t('A short sound when an agent finishes or needs you.'),
        control: ({ s, set }) => <Toggle label={t('Sounds')} checked={s.notifications.sounds} onChange={(v) => set('notifications.sounds', v)} />
      }
    ]
  },
  {
    id: 'data',
    label: tk('Data & privacy'),
    icon: Database,
    entries: () => [{ id: 'data.block', label: t('Data & privacy'), keywords: 'export import backup purge history logs database', block: () => <DataBlock /> }]
  },
  {
    id: 'about',
    label: tk('About'),
    icon: Info,
    entries: () => [{ id: 'about.block', label: t('About'), keywords: 'version licenses', block: () => <AboutBlock /> }]
  }
]

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** Whether an entry matches every word of the search. */
export function matches(entry: Entry, sectionLabel: string, query: string): boolean {
  const haystack = fold([entry.label, entry.hint ?? '', entry.keywords ?? '', sectionLabel].join(' '))
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}
