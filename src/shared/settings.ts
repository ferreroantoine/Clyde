import { z } from 'zod'

export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('light'),
  editorFontSize: z.number().int().min(9).max(32).default(13),
  terminalFontSize: z.number().int().min(9).max(32).default(13),
  /** Empty means auto-detect (pwsh, then Windows PowerShell). */
  terminalShell: z.string().max(4096).default(''),
  /** Empty means the Claude Code binary bundled with the Agent SDK. */
  claudeCodePath: z.string().max(4096).default(''),
  recentWorkspaces: z.array(z.string().max(4096)).max(20).default([])
})

export type Settings = z.output<typeof settingsSchema>
export type SettingKey = keyof Settings

export const defaultSettings: Settings = settingsSchema.parse({})
