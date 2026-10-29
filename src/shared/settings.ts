import { z } from 'zod'

/**
 * Bumped only when the structure changes (a field moves, is renamed or changes type).
 * Adding a field with a default needs no bump: missing fields fall back to their defaults.
 * Each bump comes with a step in `settingsMigrations` (main/services/settings.ts).
 */
export const SETTINGS_VERSION = 2

const path = z.string().max(4096)

export const settingsSchema = z.object({
  general: z
    .object({
      recentWorkspaces: z.array(path).max(20).default([])
    })
    .default({ recentWorkspaces: [] }),
  appearance: z
    .object({
      theme: z.enum(['light', 'dark', 'system']).default('light')
    })
    .default({ theme: 'light' }),
  editor: z
    .object({
      fontSize: z.number().int().min(9).max(32).default(13)
    })
    .default({ fontSize: 13 }),
  terminal: z
    .object({
      fontSize: z.number().int().min(9).max(32).default(13),
      /** Empty means auto-detect (pwsh, then Windows PowerShell). */
      shell: path.default('')
    })
    .default({ fontSize: 13, shell: '' }),
  usage: z
    .object({
      /** How often subscription limits are read when no agent of the account is running. */
      refreshMinutes: z.number().int().min(1).max(240).default(10),
      statusBarGauges: z.boolean().default(true),
      /** Percentages that raise an alert, per window. */
      fiveHourAlerts: z.array(z.number().int().min(1).max(100)).max(5).default([75, 90]),
      sevenDayAlerts: z.array(z.number().int().min(1).max(100)).max(5).default([85, 95])
    })
    .default({ refreshMinutes: 10, statusBarGauges: true, fiveHourAlerts: [75, 90], sevenDayAlerts: [85, 95] }),
  /** Executables of the coding CLIs. Empty means the bundled one (Claude Code) or the one on PATH. */
  cli: z
    .object({
      claudeCodePath: path.default(''),
      codexPath: path.default(''),
      antigravityPath: path.default('')
    })
    .default({ claudeCodePath: '', codexPath: '', antigravityPath: '' })
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
