import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import type { DataPaths } from '@shared/config-export'
import { handle } from './router'
import type { DataService } from '../services/data'
import type { SettingsService } from '../services/settings'
import licenses from '../licenses.json'

export function dataPaths(): DataPaths {
  const userData = app.getPath('userData')
  return { userData, database: join(userData, 'clyde.db'), logs: join(userData, 'logs') }
}

export function registerDataHandlers(data: DataService, settings: SettingsService): void {
  const windowOf = (sender: Electron.WebContents) => BrowserWindow.fromWebContents(sender) ?? undefined

  handle('settings:resetSection', ({ section }) => settings.resetSection(section))

  handle('data:export', async (_req, event) => {
    const win = windowOf(event.sender)
    const options = {
      title: t('Export configuration'),
      defaultPath: `clyde-config-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, `${JSON.stringify(data.exportConfig(), null, 2)}\n`)
    return { path: result.filePath }
  })

  handle('data:import', async (_req, event) => {
    const win = windowOf(event.sender)
    const options = { title: t('Import configuration'), properties: ['openFile' as const], filters: [{ name: 'JSON', extensions: ['json'] }] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const [file] = result.filePaths
    if (result.canceled || !file) return null
    let doc: unknown
    try {
      doc = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      throw new AppError('invalid_request', t('This file is not a Clyde configuration export.'))
    }
    return data.importConfig(doc)
  })

  handle('data:purge', () => data.purgeHistory())
  handle('data:paths', () => dataPaths())
  handle('data:open', async ({ target }) => {
    const paths = dataPaths()
    if (target === 'database') shell.showItemInFolder(paths.database)
    else await shell.openPath(paths[target])
    return null
  })
  handle('app:licenses', () => licenses)
  handle('app:pickPath', async ({ kind, title, defaultPath }, event) => {
    const win = windowOf(event.sender)
    const options = { title, properties: [kind === 'folder' ? ('openDirectory' as const) : ('openFile' as const)], ...(defaultPath ? { defaultPath } : {}) }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}
