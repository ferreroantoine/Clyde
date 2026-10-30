import { t } from '@shared/i18n'
import { defaultSettings, settingsSchema, SETTINGS_VERSION, splitPath, withSetting, type Settings } from '@shared/settings'
import { AppError } from '@shared/errors'

/** Storage backend for raw setting values; SQLite in production, memory in tests. */
export interface SettingsRepository {
  loadAll(): Record<string, unknown>
  save(key: string, value: unknown): void
  remove(key: string): void
}

export class MemorySettingsRepository implements SettingsRepository {
  private readonly values = new Map<string, unknown>()
  loadAll(): Record<string, unknown> {
    return Object.fromEntries(this.values)
  }
  save(key: string, value: unknown): void {
    this.values.set(key, value)
  }
  remove(key: string): void {
    this.values.delete(key)
  }
}

/** The whole settings document lives under this key, with its `schemaVersion`. */
export const DOCUMENT_KEY = 'settings'

type Raw = Record<string, unknown>

/** Version 1 stored one row per flat key. */
const V1_KEYS = ['theme', 'editorFontSize', 'terminalFontSize', 'terminalShell', 'claudeCodePath', 'recentWorkspaces']

/**
 * Structural migrations, keyed by the version they upgrade from. Each takes the raw document
 * and returns the next version's raw document. Values are validated after the last step.
 */
export const settingsMigrations: Record<number, (doc: Raw) => Raw> = {
  1: (v1) => ({
    general: { recentWorkspaces: v1['recentWorkspaces'] },
    appearance: { theme: v1['theme'] },
    editor: { fontSize: v1['editorFontSize'] },
    terminal: { fontSize: v1['terminalFontSize'], shell: v1['terminalShell'] },
    cli: { claudeCodePath: v1['claudeCodePath'] }
  }),
  // Keeping Clyde in the tray became the default; "quit" was only the old default, not a choice.
  2: (v2) => {
    const general = isObject(v2['general']) ? v2['general'] : {}
    return { ...v2, general: { ...general, closeBehavior: 'tray' } }
  },
  // The Agents board became the Tasks view: no worktree settings, and the start view is renamed.
  3: (v3) => {
    const general = isObject(v3['general']) ? v3['general'] : {}
    const startView = general['startView'] === 'agents' ? { startView: 'tasks' } : {}
    if (!isObject(v3['agents'])) return { ...v3, general: { ...general, ...startView } }
    const { worktreesFolder: _folder, deleteMergedWorktrees: _cleanup, ...agents } = v3['agents']
    return { ...v3, general: { ...general, ...startView }, agents }
  }
}

/** Brings a stored document of any known version up to the current one. */
export function migrateSettings(doc: Raw, from: number): Raw {
  let current = doc
  for (let v = from; v < SETTINGS_VERSION; v++) {
    const step = settingsMigrations[v]
    if (!step) throw new Error(`No settings migration from version ${v}`)
    current = step(current)
  }
  return current
}

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Keeps every valid value and falls back to the default for the rest, field by field. */
export function sanitizeSettings(doc: Raw): Settings {
  const out: Raw = {}
  for (const [section, sectionSchema] of Object.entries(settingsSchema.shape)) {
    const stored = isObject(doc[section]) ? doc[section] : {}
    const fields: Raw = {}
    for (const [key, field] of Object.entries(sectionSchema.unwrap().shape)) {
      const parsed = (field as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }).safeParse(stored[key])
      if (parsed.success) fields[key] = parsed.data
    }
    out[section] = fields
  }
  return settingsSchema.parse(out)
}

export class SettingsService {
  private current: Settings
  /** Set when the stored document comes from a newer build: changes then stay in memory. */
  private frozen = false

  constructor(private readonly repo: SettingsRepository) {
    // Unknown or invalid stored values fall back to defaults instead of failing startup.
    const stored = repo.loadAll()
    const doc = stored[DOCUMENT_KEY]
    if (isObject(doc)) {
      const version = typeof doc['schemaVersion'] === 'number' ? doc['schemaVersion'] : SETTINGS_VERSION
      if (version > SETTINGS_VERSION) {
        // Written by a newer build: read what still fits, but never overwrite it on startup.
        this.current = sanitizeSettings(doc)
        this.frozen = true
        return
      }
      this.current = sanitizeSettings(migrateSettings(doc, version))
      if (version < SETTINGS_VERSION) this.persist()
      return
    }
    const legacy = V1_KEYS.filter((k) => k in stored)
    if (legacy.length === 0) {
      this.current = defaultSettings
      return
    }
    this.current = sanitizeSettings(migrateSettings(stored, 1))
    this.persist()
    for (const key of legacy) repo.remove(key)
  }

  getAll(): Settings {
    return this.current
  }

  private readonly listeners = new Set<(next: Settings, previous: Settings) => void>()

  /** Called after every change, with the new and the previous settings. */
  onChange(listener: (next: Settings, previous: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Puts one section back to its defaults. Recent folders survive a reset of General. */
  resetSection(section: string): Settings {
    if (!(section in settingsSchema.shape)) throw new AppError('invalid_request', t('Unknown settings section "{section}"', { section }))
    const fresh = (defaultSettings as Record<string, unknown>)[section] as Record<string, unknown>
    const keep = section === 'general' ? { recentWorkspaces: this.current.general.recentWorkspaces } : {}
    return this.replace(settingsSchema.parse({ ...this.current, [section]: { ...fresh, ...keep } }))
  }

  /** Replaces everything at once (import), keeping what is valid field by field. */
  importAll(doc: Record<string, unknown>): Settings {
    return this.replace(sanitizeSettings({ ...doc, general: { ...(isObject(doc['general']) ? doc['general'] : {}), recentWorkspaces: this.current.general.recentWorkspaces } }))
  }

  private replace(next: Settings): Settings {
    const previous = this.current
    this.current = next
    this.persist()
    for (const l of this.listeners) l(next, previous)
    return next
  }

  /** Sets one value by path, e.g. `appearance.theme`. */
  set(path: string, value: unknown): Settings {
    const parts = splitPath(path)
    const section = parts && (settingsSchema.shape as Record<string, { unwrap(): { shape: Raw } }>)[parts[0]]
    if (!parts || !section || !(parts[1] in section.unwrap().shape)) {
      throw new AppError('invalid_request', t('Unknown setting "{path}"', { path }))
    }
    const next = settingsSchema.safeParse(withSetting(this.current, path, value))
    if (!next.success) throw new AppError('invalid_request', t('Invalid value for "{path}"', { path }))
    return this.replace(next.data)
  }

  private persist(): void {
    if (this.frozen) return
    this.repo.save(DOCUMENT_KEY, { schemaVersion: SETTINGS_VERSION, ...this.current })
  }
}
