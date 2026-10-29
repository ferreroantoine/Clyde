import { app } from 'electron'
import { handle } from './router'
import { DISTRIBUTION } from '../build-flags'
import type { SettingsService } from '../services/settings'

export function registerAppHandlers(settings: SettingsService): void {
  handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    userData: app.getPath('userData'),
    distribution: DISTRIBUTION
  }))
  handle('settings:getAll', () => settings.getAll())
  handle('settings:set', ({ path, value }) => settings.set(path, value))
}
