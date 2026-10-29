import { BrowserWindow, dialog } from 'electron'
import { handle } from './router'
import { t } from '@shared/i18n'
import type { WorkspaceService } from '../services/workspace'
import { listDir, readText, writeText } from '../services/files'
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
  handle('search:text', (opts) => searchText(workspace.requireRoot(), opts))
  handle('files:list', () => listFiles(workspace.requireRoot()))
}
