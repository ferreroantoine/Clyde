import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { createLogger } from './logger'
import { registerAppHandlers } from './ipc/app'
import { registerWorkspaceHandlers } from './ipc/workspace'
import { broadcast } from './ipc/events'
import { MemorySettingsRepository, SettingsService } from './services/settings'
import { WorkspaceService } from './services/workspace'

const log = createLogger('main')

app.setName('Atelier')
app.setAppUserModelId('dev.atelier.app')

process.on('uncaughtException', (err) => log.error('uncaught exception', err))
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    const settings = new SettingsService(new MemorySettingsRepository())
    const workspace = new WorkspaceService(settings, {
      onChanged: (info) => broadcast('workspace:changed', info),
      onFsChanges: (changes) => broadcast('fs:changed', changes)
    })
    registerAppHandlers(settings)
    registerWorkspaceHandlers(workspace)
    app.on('will-quit', () => void workspace.dispose())

    createMainWindow()
    log.info(`started v${app.getVersion()} (electron ${process.versions.electron})`)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
