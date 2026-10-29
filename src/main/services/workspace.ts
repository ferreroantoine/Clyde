import { existsSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { AppError } from '@shared/errors'
import type { FsChange, WorkspaceInfo } from '@shared/types'
import { WorkspaceWatcher } from './watcher'
import type { SettingsService } from './settings'

const MAX_RECENT = 10

/** Owns the single open workspace root; every file operation resolves against it. */
export class WorkspaceService {
  private info: WorkspaceInfo | null = null
  private readonly watcher: WorkspaceWatcher

  constructor(
    private readonly settings: SettingsService,
    private readonly events: {
      onChanged: (info: WorkspaceInfo | null) => void
      onFsChanges: (changes: FsChange[]) => void
    }
  ) {
    this.watcher = new WorkspaceWatcher(events.onFsChanges)
  }

  current(): WorkspaceInfo | null {
    return this.info
  }

  requireRoot(): string {
    if (!this.info) throw new AppError('no_workspace', 'Open a folder first')
    return this.info.root
  }

  async open(path: string): Promise<WorkspaceInfo> {
    let root: string
    try {
      root = await realpath(path)
      if (!(await stat(root)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new AppError('not_found', `Folder not found: ${path}`)
    }
    this.info = { root, name: basename(root) || root, isGitRepo: existsSync(join(root, '.git')) }
    this.watcher.start(root)
    this.rememberRecent(root)
    this.events.onChanged(this.info)
    return this.info
  }

  private rememberRecent(root: string): void {
    const recent = this.settings.getAll().recentWorkspaces.filter((p) => p.toLowerCase() !== root.toLowerCase())
    this.settings.set('recentWorkspaces', [root, ...recent].slice(0, MAX_RECENT))
  }

  async dispose(): Promise<void> {
    await this.watcher.stop()
  }
}
