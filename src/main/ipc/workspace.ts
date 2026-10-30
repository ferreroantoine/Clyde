import { BrowserWindow, dialog, shell } from 'electron'
import { handle } from './router'
import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import type { WorkspaceService } from '../services/workspace'
import { createDir, createFile, duplicate, listDir, readText, renamePath, statFile, writeText } from '../services/files'
import { resolveInside } from '../services/paths'
import { listFiles, searchText } from '../services/search'

export function registerWorkspaceHandlers(workspace: WorkspaceService, projectsFolder: () => string = () => ''): void {
  handle('workspace:current', () => workspace.current())
  handle('workspace:open', ({ root }) => workspace.open(root))
  handle('workspace:pick', async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const start = projectsFolder()
    const options = { title: t('Open folder'), properties: ['openDirectory' as const], ...(start ? { defaultPath: start } : {}) }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const [path] = result.filePaths
    if (result.canceled || !path) return null
    return workspace.open(path)
  })

  handle('fs:list', ({ path }) => listDir(workspace.requireRoot(), path))
  handle('fs:read', ({ path }) => readText(workspace.requireRoot(), path))
  handle('fs:write', ({ path, content }) => writeText(workspace.requireRoot(), path, content))
  handle('fs:createFile', ({ path }) => createFile(workspace.requireRoot(), path))
  handle('fs:createDir', ({ path }) => createDir(workspace.requireRoot(), path))
  handle('fs:rename', ({ from, to }) => renamePath(workspace.requireRoot(), from, to))
  handle('fs:duplicate', ({ path }) => duplicate(workspace.requireRoot(), path))
  handle('fs:trash', async ({ path }) => {
    const root = workspace.requireRoot()
    const abs = resolveInside(root, path)
    if (abs === resolveInside(root, '')) throw new AppError('outside_workspace', t('Invalid path'))
    await shell.trashItem(abs)
    return null
  })
  handle('fs:reveal', ({ path }) => {
    shell.showItemInFolder(resolveInside(workspace.requireRoot(), path))
    return null
  })
  // Files no viewer can show open in the app Windows associates with them.
  handle('fs:openDefault', async ({ path }) => {
    const error = await shell.openPath(resolveInside(workspace.requireRoot(), path))
    if (error) throw new AppError('io_error', error)
    return null
  })
  handle('fs:stat', ({ path }) => statFile(workspace.requireRoot(), path))
  handle('search:text', (opts) => searchText(workspace.requireRoot(), opts))
  handle('files:list', () => listFiles(workspace.requireRoot()))
}
