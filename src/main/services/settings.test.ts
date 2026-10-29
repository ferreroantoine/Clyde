import { describe, expect, it } from 'vitest'
import { SETTINGS_VERSION } from '@shared/settings'
import { DOCUMENT_KEY, MemorySettingsRepository, migrateSettings, SettingsService } from './settings'

describe('SettingsService', () => {
  it('starts from defaults and persists valid changes', () => {
    const repo = new MemorySettingsRepository()
    const service = new SettingsService(repo)
    expect(service.getAll().appearance.theme).toBe('light')

    service.set('appearance.theme', 'dark')
    expect(service.getAll().appearance.theme).toBe('dark')
    expect(new SettingsService(repo).getAll().appearance.theme).toBe('dark')
    expect(repo.loadAll()[DOCUMENT_KEY]).toMatchObject({ schemaVersion: SETTINGS_VERSION })
  })

  it('rejects unknown paths and invalid values', () => {
    const service = new SettingsService(new MemorySettingsRepository())
    expect(() => service.set('nope', 1)).toThrow(/Unknown setting/)
    expect(() => service.set('appearance.nope', 1)).toThrow(/Unknown setting/)
    expect(() => service.set('appearance.theme.x', 1)).toThrow(/Unknown setting/)
    expect(() => service.set('appearance.theme', 'purple')).toThrow(/Invalid value/)
    expect(service.getAll().appearance.theme).toBe('light')
  })

  it('ignores corrupt stored values field by field', () => {
    const repo = new MemorySettingsRepository()
    repo.save(DOCUMENT_KEY, { schemaVersion: SETTINGS_VERSION, editor: { fontSize: 'huge' }, terminal: { fontSize: 15 }, cli: 3 })
    const settings = new SettingsService(repo).getAll()
    expect(settings.editor.fontSize).toBe(13)
    expect(settings.terminal.fontSize).toBe(15)
    expect(settings.cli.codexPath).toBe('')
  })

  it('migrates the version 1 flat keys and removes them', () => {
    const repo = new MemorySettingsRepository()
    repo.save('theme', 'dark')
    repo.save('editorFontSize', 16)
    repo.save('terminalFontSize', 'bad')
    repo.save('terminalShell', 'C:\\Program Files\\Git\\bin\\bash.exe')
    repo.save('claudeCodePath', '')
    repo.save('recentWorkspaces', ['C:\\code\\a'])
    const settings = new SettingsService(repo).getAll()
    expect(settings).toMatchObject({
      general: { recentWorkspaces: ['C:\\code\\a'] },
      appearance: { theme: 'dark' },
      editor: { fontSize: 16 },
      terminal: { fontSize: 13, shell: 'C:\\Program Files\\Git\\bin\\bash.exe' },
      cli: { claudeCodePath: '', codexPath: '', antigravityPath: '' }
    })
    expect(Object.keys(repo.loadAll())).toEqual([DOCUMENT_KEY])
    // A second start reads the migrated document.
    expect(new SettingsService(repo).getAll().editor.fontSize).toBe(16)
  })

  it('reads a document from a newer build without overwriting it', () => {
    const repo = new MemorySettingsRepository()
    const future = { schemaVersion: SETTINGS_VERSION + 1, appearance: { theme: 'dark' }, somethingNew: { a: 1 } }
    repo.save(DOCUMENT_KEY, future)
    const service = new SettingsService(repo)
    expect(service.getAll().appearance.theme).toBe('dark')
    service.set('editor.fontSize', 20)
    expect(service.getAll().editor.fontSize).toBe(20)
    expect(repo.loadAll()[DOCUMENT_KEY]).toEqual(future)
  })

  it('refuses to migrate from an unknown version', () => {
    expect(() => migrateSettings({}, 0)).toThrow(/No settings migration/)
  })
})
