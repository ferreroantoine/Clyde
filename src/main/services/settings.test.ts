import { describe, expect, it } from 'vitest'
import { MemorySettingsRepository, SettingsService } from './settings'

describe('SettingsService', () => {
  it('starts from defaults and persists valid changes', () => {
    const repo = new MemorySettingsRepository()
    const service = new SettingsService(repo)
    expect(service.getAll().theme).toBe('light')

    service.set('theme', 'dark')
    expect(service.getAll().theme).toBe('dark')
    expect(new SettingsService(repo).getAll().theme).toBe('dark')
  })

  it('rejects unknown keys and invalid values', () => {
    const service = new SettingsService(new MemorySettingsRepository())
    expect(() => service.set('nope', 1)).toThrow(/Unknown setting/)
    expect(() => service.set('theme', 'purple')).toThrow(/Invalid value/)
    expect(service.getAll().theme).toBe('light')
  })

  it('ignores corrupt stored values', () => {
    const repo = new MemorySettingsRepository()
    repo.save('editorFontSize', 'huge')
    expect(new SettingsService(repo).getAll().editorFontSize).toBe(13)
  })
})
