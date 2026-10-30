import { join } from 'node:path'
import { app, BrowserWindow, dialog, net, Notification } from 'electron'
import { isEnded, type AgentEventEnvelope } from '@shared/agent'
import { resolveLocale, setLocale, t } from '@shared/i18n'
import { handleClose, refreshTray, syncTray } from './tray'
import { openDatabase, migrate, type Db } from './services/db/database'
import { SqliteSettingsRepository } from './services/db/settings-repo'
import { createMainWindow } from './window'
import { createLogger } from './logger'
import { registerAppHandlers } from './ipc/app'
import { registerWorkspaceHandlers } from './ipc/workspace'
import { broadcast } from './ipc/events'
import { MemorySettingsRepository, SettingsService } from './services/settings'
import { NoticesService } from './services/notices'
import { CliDetectService } from './services/cli-detect'
import { WorkspaceService } from './services/workspace'
import { hasPwsh, PtyService } from './services/pty'
import { registerTerminalHandlers } from './ipc/terminal'
import { registerProfileHandlers } from './ipc/profiles'
import { registerAgentHandlers } from './ipc/agents'
import { SecretsService, safeStorageCipher } from './services/secrets'
import { ProfilesService } from './services/profiles'
import { AgentManager, CONTINUE_MESSAGE } from './agents/manager'
import { MediaStore } from './agents/media'
import { LimitGuard } from './agents/limit-guard'
import { createAdapter } from './agents/api/clients'
import { McpStore } from './mcp/store'
import { McpHub } from './mcp/hub'
import { registerMcpHandlers } from './ipc/mcp'
import { registerTaskHandlers } from './ipc/tasks'
import { registerMetricsHandlers } from './ipc/metrics'
import { MetricsService } from './metrics/metrics'
import { setupLimits } from './limits/setup'
import { DataService } from './services/data'
import { registerDataHandlers } from './ipc/data'
import { registerLimitsHandlers } from './ipc/limits'
import { AgentDefinitionsService } from './services/agent-definitions'
import { WorktreeService } from './services/worktrees'
import { TaskService } from './agents/tasks'
import { ChatStore } from './chat/store'
import { ChatService } from './chat/service'
import { ChatSearch, ollamaEmbed } from './chat/search'
import { registerChatHandlers } from './ipc/chat'
import { VoiceService } from './voice/service'
import { InternalModel } from './context/internal'
import { SUMMARY_SYSTEM, TITLE_SYSTEM } from './context/history'
import { MemoryService } from './memory/service'
import { registerMemoryHandlers } from './ipc/memory'
import { registerVoiceHandlers } from './ipc/voice'
import { loadQuery, type QueryFn } from './agents/claude-code/provider'
import { DISTRIBUTION } from './build-flags'

const log = createLogger('main')

app.setName('Clyde')
app.setAppUserModelId('dev.clyde.app')
// CLYDE_USER_DATA lets scripts and tests run against a throwaway profile. The portable build
// (electron-builder sets PORTABLE_EXECUTABLE_DIR) keeps its data in a folder next to the exe.
const portableDir = process.env['PORTABLE_EXECUTABLE_DIR']
const userDataOverride = process.env['CLYDE_USER_DATA'] || (portableDir ? join(portableDir, 'Clyde-data') : undefined)
if (userDataOverride) app.setPath('userData', userDataOverride)

let queryFn: Promise<QueryFn> | null = null
let mainWindow: BrowserWindow | null = null
/** Set when the app quits: sessions ending then are not "finished" (no memory proposals). */
let shuttingDown = false
const query = () => (queryFn ??= loadQuery())

/** Opens and migrates the app database; on failure the app still starts, with settings kept in memory. */
function openAppDatabase(): Db | null {
  const file = join(app.getPath('userData'), 'clyde.db')
  try {
    const db = openDatabase(file)
    const version = migrate(db)
    log.info(`database ready (schema v${version})`)
    return db
  } catch (err) {
    log.error('could not open the database', err)
    dialog.showErrorBox(
      t('Clyde could not open its database'),
      t('{message}\n\nFile: {file}\n\nSettings will not be saved during this session.', { message: (err as Error).message, file })
    )
    return null
  }
}

/** %LOCALAPPDATA%\\Clyde\\worktrees on Windows (not roaming), the app data folder elsewhere. */
function worktreesRoot(): string {
  const local = process.env['LOCALAPPDATA']
  if (process.platform === 'win32' && local && !userDataOverride) return join(local, 'Clyde', 'worktrees')
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
      // It may be hidden in the tray.
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  void app.whenReady().then(async () => {
    const db = openAppDatabase()
    const settings = new SettingsService(db ? new SqliteSettingsRepository(db) : new MemorySettingsRepository())
    // Main's own messages (errors, notifications, dialogs) follow the interface language.
    const applyLocale = () => setLocale(resolveLocale(settings.getAll().general.language, app.getLocale()))
    applyLocale()
    settings.onChange(applyLocale)
    // Created once the services it reads exist; callbacks before that skip it.
    // eslint-disable-next-line prefer-const -- assigned below, after the services it needs
    let memory: MemoryService | undefined
    const workspace = new WorkspaceService(settings, {
      onChanged: (info) => {
        broadcast('workspace:changed', info)
        // The open project's memory reaches its CLAUDE.md / AGENTS.md.
        try {
          memory?.sync()
        } catch (err) {
          log.warn('memory sync failed', err)
        }
      },
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
    registerWorkspaceHandlers(workspace, () => settings.getAll().general.projectsFolder)
    registerTerminalHandlers(ptys, workspace)

    const clientApp = `clyde/${app.getVersion()}`
    const claudeCodePath = () => settings.getAll().cli.claudeCodePath
    const codexPath = () => settings.getAll().cli.codexPath
    const antigravityPath = () => settings.getAll().cli.antigravityPath
    const cli = new CliDetectService({
      paths: () => ({ 'claude-code': claudeCodePath(), codex: codexPath(), antigravity: antigravityPath() })
    })
    void cli.status().catch((err) => log.warn('could not detect the coding CLIs', err))
    // Without the app database, profiles live in memory for this session, like settings.
    const profileDb = db ?? memoryDatabase()
    // Declared before the services whose callbacks use it; assigned once they exist.
    // eslint-disable-next-line prefer-const -- assigned below, after the agent manager it needs
    let limitsSetup: ReturnType<typeof setupLimits>
    const profiles = new ProfilesService(profileDb, new SecretsService(profileDb, safeStorageCipher), {
      dataRoot: app.getPath('userData'),
      distribution: DISTRIBUTION,
      onChanged: (list) => {
        broadcast('profiles:changed', list)
        limitsSetup.syncProfiles(list)
        try {
          memory?.sync()
        } catch (err) {
          log.warn('memory sync failed', err)
        }
      }
    })
    const mcpStore = new McpStore(profileDb, safeStorageCipher)
    const mcp = new McpHub(mcpStore, {
      onChanged: (list) => broadcast('mcp:changed', list),
      log: createLogger('mcp')
    })
    // net.fetch goes through Chromium's network stack, so system proxies apply to API calls too.
    const fetch = ((input, init) => net.fetch(input as string, init)) as typeof globalThis.fetch
    // Clyde's own small tasks go to a local model by default (Settings › Memory & context).
    const internal = new InternalModel({
      settings: () => settings.getAll().memory,
      profiles: () => profiles.list(),
      apiKey: (id) => profiles.apiKey(id),
      createAdapter: (target) => createAdapter(target, fetch)
    })
    const media = new MediaStore(join(app.getPath('userData'), 'session-media'))
    const agents = new AgentManager({
      media,
      memory: () => memory?.forPrompt() ?? '',
      summarizeAt: () => settings.getAll().memory.summarizeAt,
      summarize: (transcript, fallback, signal) =>
        internal.complete({ system: SUMMARY_SYSTEM, prompt: transcript, ...(fallback ? { fallback } : {}), ...(signal ? { signal } : {}) }),
      transcript: (id) => metrics.transcriptText(id),
      profiles,
      maxParallel: () => settings.getAll().agents.maxParallel,
      defaultModel: () => settings.getAll().agents.defaultModel,
      mcp,
      createAdapter: (target) => createAdapter(target, fetch),
      hasPwsh,
      claudeCodePath,
      codexPath,
      antigravityPath,
      cliVersion: (kind) => cli.versionOf(kind),
      workspaceRoot: () => workspace.current()?.root ?? null,
      query,
      onEvent: (envelope) => {
        broadcast('agent:event', envelope)
        metrics.onEvent(envelope)
        tasks.onAgentEvent(envelope)
        chat.onAgentEvent(envelope)
        limitsSetup.onAgentEvent(envelope)
        guard.onEvent(envelope)
        notifyAgent(envelope)
      },
      onLimits: (profileId, sessionId, readings) => limitsSetup.ingest(profileId, readings, sessionId),
      onSession: (info) => {
        broadcast('agent:session', info)
        // End of a project session: the agent may propose memory changes, to review in Settings.
        if (info.status === 'stopped' && !shuttingDown && !info.chatId && settings.getAll().memory.proposeAtSessionEnd && internal.target()) {
          void memory?.proposeFromSession(info.id).catch((err) => log.warn('memory proposal failed', err))
        }
        metrics.onSession(info)
        tasks.onSession(info)
        if (mainWindow) refreshTray(mainWindow, background)
      },
      store: {
        saveRequest: (id, request) => metrics.saveRequest(id, request),
        resumable: (id) => metrics.resumable(id)
      },
      clientApp,
      log: createLogger('agents')
    })
    const background = {
      behavior: () => settings.getAll().general.closeBehavior,
      busy: () => agents.busyCount()
    }
    limitsSetup = setupLimits({
      db: profileDb,
      profiles,
      sessions: () => agents.list(),
      settings: () => settings.getAll(),
      query,
      clientApp,
      log: createLogger('limits')
    })
    registerProfileHandlers({ profiles, ptys, claudeCodePath, codexPath, antigravityPath, cli, query, clientApp, fetch })
    // Usage limits mid-task: ask, wait for the reset, or move to a fallback account (Settings › Agents).
    const guard: LimitGuard = new LimitGuard({
      db: profileDb,
      settings: () => settings.getAll().agents,
      profiles: () => profiles.list(),
      limits: (id) => limitsSetup.limits.profileLimits(id),
      sessions: agents,
      onScheduled: (sessionId, at) => broadcast('agent:resumeScheduled', { sessionId, at }),
      log: createLogger('limits')
    })
    registerAgentHandlers(agents, {
      metrics: { history: (cwd) => metrics.history(cwd), stored: (id) => metrics.stored(id) },
      media,
      guard,
      workspaceRoot: () => workspace.current()?.root ?? null
    })
    registerMcpHandlers(mcp, {
      list: () => mcpStore.presets(),
      save: (serverId, title, description) => mcpStore.savePreset(serverId, title, description),
      remove: (id) => mcpStore.deletePreset(id)
    })
    mcp.start()

    const definitions = new AgentDefinitionsService(profileDb, (list) => broadcast('agents:changed', list))
    const tasks: TaskService = new TaskService(profileDb, {
      worktrees: new WorktreeService(() => settings.getAll().agents.worktreesFolder.trim() || worktreesRoot()),
      deleteMergedWorktrees: () => settings.getAll().agents.deleteMergedWorktrees,
      agents: definitions,
      sessions: agents,
      workspaceRoot: () => workspace.current()?.root ?? null,
      onChanged: (list) => broadcast('tasks:changed', list)
    })
    tasks.recover()
    registerTaskHandlers(definitions, tasks)

    // "Use my past conversations": embeddings from the first Ollama account (Settings › Memory & context).
    const chatSearch = new ChatSearch(
      profileDb,
      ollamaEmbed(
        fetch,
        () => profiles.list().find((p) => p.kind === 'ollama' && p.usable)?.baseUrl ?? null,
        () => settings.getAll().memory.embeddingModel
      )
    )
    const chat: ChatService = new ChatService({
      store: new ChatStore(profileDb),
      sessions: agents,
      profiles: () => profiles.list(),
      agents: () => definitions.list(),
      root: join(app.getPath('userData'), 'chat'),
      workspaceRoot: () => workspace.current()?.root ?? null,
      defaultPermission: () => settings.getAll().agents.defaultPermission,
      onChanged: (list) => broadcast('chat:changed', list),
      onMessage: (message) => broadcast('chat:message', message),
      onLive: (live) => broadcast('chat:live', live),
      search: () => (settings.getAll().memory.historySearch ? chatSearch : null),
      title: async (exchange) => {
        if (!internal.target()) return null
        const title = await internal.complete({ system: TITLE_SYSTEM, prompt: exchange })
        return title.replace(/^["'«\s]+|["'»\s.]+$/g, '').slice(0, 80) || null
      }
    })
    registerChatHandlers(chat)
    memory = new MemoryService({
      db: profileDb,
      userDir: join(app.getPath('userData'), 'memory'),
      workspaceRoot: () => workspace.current()?.root ?? null,
      profiles: () => profiles.list(),
      configDir: (id) => profiles.configDir(id),
      budget: () => settings.getAll().memory.coreBudget,
      internal,
      transcript: (id) => metrics.transcriptText(id),
      onChanged: (state) => broadcast('memory:changed', state)
    })
    registerMemoryHandlers(memory)
    registerVoiceHandlers(
      new VoiceService({
        root: join(app.getPath('userData'), 'whisper'),
        settings: () => settings.getAll().voice,
        profiles: () => profiles.list(),
        apiKey: (id) => profiles.apiKey(id),
        fetch,
        createAdapter: (target) => createAdapter(target, fetch),
        onProgress: (progress) => broadcast('voice:progress', progress)
      })
    )

    const metrics: MetricsService = new MetricsService(profileDb, {
      profiles: () => profiles.list(),
      activeSessions: () => agents.list(),
      sessionLimits: (id) => limitsSetup.limits.sessionUsage(id)
    })
    metrics.recover()
    registerMetricsHandlers(metrics)
    registerDataHandlers(
      new DataService({
        db: profileDb,
        settings,
        profiles,
        agents: definitions,
        mcp,
        metrics,
        activeSessionIds: () => agents.list().filter((s) => !isEnded(s.status)).map((s) => s.id),
        clearMedia: (keep) => media.clear(keep)
      }),
      settings
    )
    registerLimitsHandlers({ limits: limitsSetup.limits, poller: limitsSetup.poller, diagnose: limitsSetup.diagnose })
    limitsSetup.syncProfiles(profiles.list())
    limitsSetup.poller.start()

    app.on('will-quit', () => {
      // Working sessions are marked interrupted, so they can be resumed at the next start.
      shuttingDown = true
      guard.dispose()
      agents.shutdown()
      void limitsSetup.dispose()
      void mcp.dispose()
      ptys.killAll()
      void workspace.dispose()
      db?.close()
    })

    // Reopen the last workspace before the window asks for it.
    const [last] = settings.getAll().general.recentWorkspaces
    if (last && settings.getAll().general.reopenLastProject) {
      await workspace.open(last).catch((err) => log.warn('could not reopen last workspace', err))
    }

    const win = createMainWindow()
    mainWindow = win
    handleClose(win, background)
    // Settings › Appearance › interface text size scales the whole window, Monaco and xterm included.
    const zoom = () => win.webContents.setZoomFactor(settings.getAll().appearance.uiFontSize / 13)
    win.webContents.on('did-finish-load', zoom)
    settings.onChange((next, previous) => {
      if (next.appearance.uiFontSize !== previous.appearance.uiFontSize) zoom()
      if (next.general.closeBehavior !== previous.general.closeBehavior) syncTray(win, background)
    })

    // Resumes planned before the last shutdown (a usage limit that resets later).
    guard.restore()
    // Settings › Agents: sessions the last shutdown cut (within a day) carry on by themselves.
    if (settings.getAll().agents.resumeOnStart) {
      for (const id of metrics.interruptedSince(Date.now() - 24 * 60 * 60 * 1000)) {
        try {
          await agents.resume(id)
          agents.send(id, CONTINUE_MESSAGE)
        } catch (err) {
          log.warn(`could not resume session ${id}`, err)
        }
      }
    }

    /** Desktop notifications for agents, when the window is in the background. */
    function notifyAgent(envelope: AgentEventEnvelope): void {
      const { event } = envelope
      const prefs = settings.getAll().notifications
      const wanted = (event.type === 'turn_end' && prefs.agentDone) || (event.type === 'approval_request' && prefs.approvalNeeded)
      if (!wanted || win.isDestroyed() || win.isFocused() || !Notification.isSupported()) return
      const session = agents.get(envelope.sessionId)
      const profile = session ? profiles.list().find((p) => p.id === session.profileId) : undefined
      const who = profile?.name ?? t('An agent')
      const note =
        event.type === 'approval_request'
          ? new Notification({ title: t('{name} needs your approval', { name: who }), body: event.reason })
          : new Notification({
              title: event.type === 'turn_end' && event.isError ? t('{name} stopped with an error', { name: who }) : t('{name} has finished', { name: who }),
              body: event.type === 'turn_end' && event.isError ? (event.errors[0] ?? '') : t('Its answer is in the agent panel.')
            })
      note.on('click', () => {
        win.show()
        win.focus()
      })
      note.show()
    }
    log.info(`started v${app.getVersion()} (electron ${process.versions.electron})`)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
