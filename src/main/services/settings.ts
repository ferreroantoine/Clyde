import { settingsSchema, type Settings } from '@shared/settings'
import { AppError } from '@shared/errors'

/** Storage backend for raw setting values; SQLite in production, memory in tests. */
export interface SettingsRepository {
  loadAll(): Record<string, unknown>
  save(key: string, value: unknown): void
}

export class MemorySettingsRepository implements SettingsRepository {
  private readonly values = new Map<string, unknown>()
  loadAll(): Record<string, unknown> {
    return Object.fromEntries(this.values)
  }
  save(key: string, value: unknown): void {
    this.values.set(key, value)
  }
}

const keys = new Set(Object.keys(settingsSchema.shape))

export class SettingsService {
  private current: Settings

  constructor(private readonly repo: SettingsRepository) {
    // Unknown or invalid stored values fall back to defaults instead of failing startup.
    const stored = repo.loadAll()
    const merged: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(settingsSchema.shape)) {
      const parsed = field.safeParse(stored[key])
      if (parsed.success) merged[key] = parsed.data
    }
    this.current = settingsSchema.parse(merged)
  }

  getAll(): Settings {
    return this.current
  }

  set(key: string, value: unknown): Settings {
    if (!keys.has(key)) throw new AppError('invalid_request', `Unknown setting "${key}"`)
    const next = settingsSchema.safeParse({ ...this.current, [key]: value })
    if (!next.success) throw new AppError('invalid_request', `Invalid value for "${key}"`)
    this.current = next.data
    this.repo.save(key, next.data[key as keyof Settings])
    return this.current
  }
}
