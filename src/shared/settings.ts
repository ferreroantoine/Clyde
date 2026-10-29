import { z } from 'zod'

/**
 * Bumped only when the structure changes (a field moves, is renamed or changes type).
 * Adding a field with a default needs no bump: missing fields fall back to their defaults.
 * Each bump comes with a step in `settingsMigrations` (main/services/settings.ts).
 */
export const SETTINGS_VERSION = 2

const path = z.string().max(4096)

export const LANGUAGES = ['system', 'en', 'fr'] as const
export const START_VIEWS = ['chat', 'editor', 'agents', 'supervision'] as const
export const ACCENTS = ['indigo', 'blue', 'teal', 'green', 'orange', 'rose', 'violet', 'slate'] as const
export const ANIMATION_LEVELS = ['full', 'reduced', 'off'] as const
export type AnimationLevel = (typeof ANIMATION_LEVELS)[number]
const PERMISSION_LEVELS = ['validate-all', 'files-auto', 'autonomous'] as const

const DEFAULT_MONO = "'JetBrains Mono Variable', 'Cascadia Code', Consolas, monospace"

/** `z.object(shape).default(...)` with the defaults computed from the shape itself. */
function section<T extends z.ZodRawShape>(shape: T) {
  const object = z.object(shape)
  return object.default(object.parse({}) as never)
}

export const settingsSchema = z.object({
  general: section({
    language: z.enum(LANGUAGES).default('system'),
    startView: z.enum(START_VIEWS).default('chat'),
    reopenLastProject: z.boolean().default(true),
    /** Where "Open folder" starts. Empty means the user's home. */
    projectsFolder: path.default(''),
    closeBehavior: z.enum(['quit', 'tray']).default('quit'),
    recentWorkspaces: z.array(path).max(20).default([])
  }),
  appearance: section({
    theme: z.enum(['light', 'dark', 'system']).default('light'),
    accent: z.enum(ACCENTS).default('indigo'),
    density: z.enum(['compact', 'comfortable']).default('comfortable'),
    /** Interface text size in px; the whole window scales from 13. */
    uiFontSize: z.number().int().min(11).max(18).default(13),
    animations: z.enum(ANIMATION_LEVELS).default('full')
  }),
  agents: section({
    defaultPermission: z.enum(PERMISSION_LEVELS).default('validate-all'),
    /** Used when neither the agent nor its account sets one. */
    defaultModel: z.string().trim().max(200).default(''),
    maxParallel: z.number().int().min(1).max(16).default(4),
    /** Empty means %LOCALAPPDATA%\\Atelier\\worktrees. */
    worktreesFolder: path.default(''),
    deleteMergedWorktrees: z.boolean().default(true)
  }),
  editor: section({
    fontFamily: z.string().trim().max(300).default(DEFAULT_MONO),
    fontSize: z.number().int().min(9).max(32).default(13),
    tabSize: z.number().int().min(1).max(8).default(2),
    wordWrap: z.boolean().default(false),
    minimap: z.boolean().default(true),
    formatOnSave: z.boolean().default(false)
  }),
  terminal: section({
    fontFamily: z.string().trim().max(300).default(DEFAULT_MONO),
    fontSize: z.number().int().min(9).max(32).default(13),
    /** Empty means auto-detect (pwsh, then Windows PowerShell). */
    shell: path.default(''),
    scrollback: z.number().int().min(100).max(100_000).default(10_000)
  }),
  usage: section({
    /** How often subscription limits are read when no agent of the account is running. */
    refreshMinutes: z.number().int().min(1).max(240).default(10),
    statusBarGauges: z.boolean().default(true),
    /** Percentages that raise an alert, per window. */
    fiveHourAlerts: z.array(z.number().int().min(1).max(100)).max(5).default([75, 90]),
    sevenDayAlerts: z.array(z.number().int().min(1).max(100)).max(5).default([85, 95])
  }),
  notifications: section({
    /** Desktop notifications, shown when the window is not focused. */
    agentDone: z.boolean().default(true),
    approvalNeeded: z.boolean().default(true),
    sounds: z.boolean().default(false)
  }),
  /** Keyboard shortcuts changed by the user: command id → combo ("" removes the shortcut). */
  shortcuts: section({
    bindings: z.record(z.string().max(64), z.string().max(64)).default({})
  }),
  /** Executables of the coding CLIs. Empty means the bundled one (Claude Code) or the one on PATH. */
  cli: section({
    claudeCodePath: path.default(''),
    codexPath: path.default(''),
    antigravityPath: path.default('')
  })
})

export type Settings = z.output<typeof settingsSchema>
export type SettingSection = keyof Settings

/** `section.key`, e.g. `appearance.theme`. */
export type SettingPath = {
  [S in SettingSection]: `${S}.${keyof Settings[S] & string}`
}[SettingSection]

export type SettingValue<P extends SettingPath> = P extends `${infer S extends SettingSection}.${infer K}`
  ? K extends keyof Settings[S]
    ? Settings[S][K]
    : never
  : never

export const defaultSettings: Settings = settingsSchema.parse({})

export function splitPath(path: string): [string, string] | null {
  const dot = path.indexOf('.')
  if (dot <= 0 || dot === path.length - 1 || path.indexOf('.', dot + 1) !== -1) return null
  return [path.slice(0, dot), path.slice(dot + 1)]
}

/** Returns a copy of `settings` with one value replaced. The caller validates the result. */
export function withSetting(settings: Settings, path: string, value: unknown): Record<string, unknown> {
  const parts = splitPath(path)
  if (!parts) return { ...settings }
  const [section, key] = parts
  const current = (settings as Record<string, Record<string, unknown>>)[section] ?? {}
  return { ...settings, [section]: { ...current, [key]: value } }
}
