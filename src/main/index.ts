import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { openDatabase, migrate, type Db } from './services/db/database'
import { SqliteSettingsRepository } from './services/db/settings-repo'
import { createMainWindow } from './window'
import { createLogger } from './logger'
import { registerAppHandlers } from './ipc/app'
import { registerWorkspaceHandlers } from './ipc/workspace'
import { broadcast } from './ipc/events'
import { MemorySettingsRepository, SettingsService } from './services/settings'
import { WorkspaceService } from './services/workspace'
import { PtyService } from './services/pty'
import { registerTerminalHandlers } from './ipc/terminal'

const log = createLogger('main')

app.setName('Atelier')
app.setAppUserModelId('dev.atelier.app')
// Lets scripts and tests run against a throwaway profile.
const userDataOverride = process.env['ATELIER_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

/** Opens and migrates the app database; on failure the app still starts, with settings kept in memory. */
function openAppDatabase(): Db | null {
  const file = join(app.getPath('userData'), 'atelier.db')
  try {
    const db = openDatabase(file)
    const version = migrate(db)
    log.info(`database ready (schema v${version})`)
    return db
  } catch (err) {
    log.error('could not open the database', err)
    dialog.showErrorBox(
      'Atelier could not open its database',
      `${(err as Error).message}\n\nFile: ${file}\n\nSettings will not be saved during this session.`
    )
    return null
  }
}

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

  void app.whenReady().then(async () => {
    const db = openAppDatabase()
    const settings = new SettingsService(db ? new SqliteSettingsRepository(db) : new MemorySettingsRepository())
    const workspace = new WorkspaceService(settings, {
      onChanged: (info) => broadcast('workspace:changed', info),
      onFsChanges: (changes) => broadcast('fs:changed', changes)
    })
    const ptys = new PtyService(
      {
        onData: (id, data) => broadcast('pty:data', { id, data }),
        onExit: (id, exitCode) => broadcast('pty:exit', { id, exitCode })
      },
      () => settings.getAll().terminalShell
    )
    registerAppHandlers(settings)
    registerWorkspaceHandlers(workspace)
    registerTerminalHandlers(ptys, workspace)
    app.on('will-quit', () => {
      ptys.killAll()
      void workspace.dispose()
      db?.close()
    })

    // Reopen the last workspace before the window asks for it.
    const [last] = settings.getAll().recentWorkspaces
    if (last) await workspace.open(last).catch((err) => log.warn('could not reopen last workspace', err))

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
