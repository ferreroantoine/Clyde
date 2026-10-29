import { join } from 'node:path'
import { app, BrowserWindow, dialog, net } from 'electron'
import { openDatabase, migrate, type Db } from './services/db/database'
import { SqliteSettingsRepository } from './services/db/settings-repo'
import { createMainWindow } from './window'
import { createLogger } from './logger'
import { registerAppHandlers } from './ipc/app'
import { registerWorkspaceHandlers } from './ipc/workspace'
import { broadcast } from './ipc/events'
import { MemorySettingsRepository, SettingsService } from './services/settings'
import { NoticesService } from './services/notices'
import { WorkspaceService } from './services/workspace'
import { hasPwsh, PtyService } from './services/pty'
import { registerTerminalHandlers } from './ipc/terminal'
import { registerProfileHandlers } from './ipc/profiles'
import { registerAgentHandlers } from './ipc/agents'
import { SecretsService, safeStorageCipher } from './services/secrets'
import { ProfilesService } from './services/profiles'
import { AgentManager } from './agents/manager'
import { createAdapter } from './agents/api/clients'
import { McpStore } from './mcp/store'
import { McpHub } from './mcp/hub'
import { registerMcpHandlers } from './ipc/mcp'
import { registerTaskHandlers } from './ipc/tasks'
import { registerMetricsHandlers } from './ipc/metrics'
import { MetricsService } from './metrics/metrics'
import { AgentDefinitionsService } from './services/agent-definitions'
import { WorktreeService } from './services/worktrees'
import { TaskService } from './agents/tasks'
import { loadQuery, type QueryFn } from './agents/claude-code/provider'
import { DISTRIBUTION } from './build-flags'

const log = createLogger('main')

app.setName('Atelier')
app.setAppUserModelId('dev.atelier.app')
// Lets scripts and tests run against a throwaway profile.
const userDataOverride = process.env['ATELIER_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

let queryFn: Promise<QueryFn> | null = null
const query = () => (queryFn ??= loadQuery())

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

/** %LOCALAPPDATA%\\Atelier\\worktrees on Windows (not roaming), the app data folder elsewhere. */
function worktreesRoot(): string {
  const local = process.env['LOCALAPPDATA']
  if (process.platform === 'win32' && local && !userDataOverride) return join(local, 'Atelier', 'worktrees')
  return join(app.getPath('userData'), 'worktrees')
}

function memoryDatabase(): Db {
  const mem = openDatabase(':memory:')
  migrate(mem)
  return mem
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
      () => settings.getAll().terminal.shell
    )
    registerAppHandlers(settings, db ? new NoticesService(db) : null)
    registerWorkspaceHandlers(workspace)
    registerTerminalHandlers(ptys, workspace)

    const clientApp = `atelier/${app.getVersion()}`
    const claudeCodePath = () => settings.getAll().cli.claudeCodePath
    // Without the app database, profiles live in memory for this session, like settings.
    const profileDb = db ?? memoryDatabase()
    const profiles = new ProfilesService(profileDb, new SecretsService(profileDb, safeStorageCipher), {
      profilesRoot: join(app.getPath('userData'), 'claude-profiles'),
      distribution: DISTRIBUTION,
      onChanged: (list) => broadcast('profiles:changed', list)
    })
    const mcp = new McpHub(new McpStore(profileDb, safeStorageCipher), {
      onChanged: (list) => broadcast('mcp:changed', list),
      log: createLogger('mcp')
    })
    // net.fetch goes through Chromium's network stack, so system proxies apply to API calls too.
    const fetch = ((input, init) => net.fetch(input as string, init)) as typeof globalThis.fetch
    const agents = new AgentManager({
      profiles,
      mcp,
      createAdapter: (target) => createAdapter(target, fetch),
      hasPwsh,
      claudeCodePath,
      workspaceRoot: () => workspace.current()?.root ?? null,
      query,
      onEvent: (envelope) => {
        broadcast('agent:event', envelope)
        metrics.onEvent(envelope)
        tasks.onAgentEvent(envelope)
      },
      onSession: (info) => {
        broadcast('agent:session', info)
        metrics.onSession(info)
        tasks.onSession(info)
      },
      clientApp,
      log: createLogger('agents')
    })
    registerProfileHandlers({ profiles, ptys, claudeCodePath, query, clientApp, fetch })
    registerAgentHandlers(agents)
    registerMcpHandlers(mcp)
    mcp.start()

    const definitions = new AgentDefinitionsService(profileDb, (list) => broadcast('agents:changed', list))
    const tasks: TaskService = new TaskService(profileDb, {
      worktrees: new WorktreeService(worktreesRoot()),
      agents: definitions,
      sessions: agents,
      workspaceRoot: () => workspace.current()?.root ?? null,
      onChanged: (list) => broadcast('tasks:changed', list)
    })
    tasks.recover()
    registerTaskHandlers(definitions, tasks)

    const metrics: MetricsService = new MetricsService(profileDb, {
      profiles: () => profiles.list(),
      activeSessions: () => agents.list()
    })
    metrics.recover()
    registerMetricsHandlers(metrics)

    app.on('will-quit', () => {
      agents.stopAll()
      void mcp.dispose()
      ptys.killAll()
      void workspace.dispose()
      db?.close()
    })

    // Reopen the last workspace before the window asks for it.
    const [last] = settings.getAll().general.recentWorkspaces
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
