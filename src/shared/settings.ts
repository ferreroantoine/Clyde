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
export const VOICE_ENGINES = ['local', 'api'] as const
/** Whisper models Clyde can download (ggml files of the whisper.cpp repository on Hugging Face). */
export const WHISPER_MODEL_IDS = ['tiny', 'base', 'small', 'medium', 'large-v3-turbo-q5_0', 'large-v3-turbo'] as const
export type WhisperModelId = (typeof WHISPER_MODEL_IDS)[number]
export const VOICE_LANGUAGES = ['auto', 'fr', 'en', 'de', 'es', 'it', 'pt', 'nl'] as const
/** Fillers removed from transcripts by default, French and English. */
export const DEFAULT_HESITATIONS = ['euh', 'heu', 'hum', 'hmm', 'bah', 'beh', 'um', 'uh', 'erm', 'uhm'] as const

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
    /** Empty means %LOCALAPPDATA%\\Clyde\\worktrees. */
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
  /** Dictation. Audio stays on the machine with the local engine (whisper.cpp). */
  voice: section({
    engine: z.enum(VOICE_ENGINES).default('local'),
    /** Whisper model for the local engine; downloaded from Settings › Voice. */
    model: z.enum(WHISPER_MODEL_IDS).default('base'),
    /** Spoken language, or "auto" to detect it. */
    language: z.enum(VOICE_LANGUAGES).default('fr'),
    /** An OpenAI or Gemini account, for the API engine. */
    apiProfileId: z.string().max(64).default(''),
    mode: z.enum(['toggle', 'hold']).default('toggle'),
    /** Microphone device id; empty means the system default. */
    microphone: z.string().max(512).default(''),
    removeHesitations: z.boolean().default(true),
    hesitations: z.array(z.string().trim().min(1).max(30)).max(100).default([...DEFAULT_HESITATIONS]),
    /** Rewrite the transcript with a light model (punctuation, repetitions, false starts). */
    rewrite: z.boolean().default(false),
    /** The account that rewrites; empty means the first Ollama account. */
    rewriteProfileId: z.string().max(64).default(''),
    /** A whisper-cli built by the user (e.g. with Vulkan); empty means the one Clyde downloads. */
    whisperPath: path.default(''),
    useGpu: z.boolean().default(true)
  }),
  /** Memory shared by all agents, and how the context is kept small. */
  memory: section({
    /** Tokens the memory core may use; past it, Settings › Memory warns. */
    coreBudget: z.number().int().min(200).max(20_000).default(1_500),
    /** Clyde's loop summarizes older turns past this many tokens of history (0: never). */
    summarizeAt: z.number().int().min(0).max(2_000_000).default(80_000),
    /** CLI sessions suggest compacting past this share of the context window. */
    compactSuggestPct: z.number().int().min(30).max(98).default(80),
    /** The account for Clyde's own small tasks (summaries, titles, memory proposals). Empty: the first Ollama account. */
    internalProfileId: z.string().max(64).default(''),
    internalModel: z.string().trim().max(200).default(''),
    /** At the end of a session, the agent proposes memory changes to review. */
    proposeAtSessionEnd: z.boolean().default(true),
    /** Chat: find relevant passages of past conversations with local embeddings (Ollama). */
    historySearch: z.boolean().default(false),
    embeddingModel: z.string().trim().max(200).default('nomic-embed-text')
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
