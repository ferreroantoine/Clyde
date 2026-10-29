import { app } from 'electron'
import { handle } from './router'
import type { SettingsService } from '../services/settings'

export function registerAppHandlers(settings: SettingsService): void {
  handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    userData: app.getPath('userData')
  }))
  handle('settings:getAll', () => settings.getAll())
  handle('settings:set', ({ key, value }) => settings.set(key, value))
}
