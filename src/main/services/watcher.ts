import { watch, type FSWatcher } from 'chokidar'
import type { FsChange, FsChangeKind } from '@shared/types'
import { toRel } from './paths'
import { createLogger } from '../logger'

const log = createLogger('watcher')
const IGNORED = /[\\/](?:\.git|node_modules|out|dist)(?:[\\/]|$)/
const FLUSH_MS = 120
const KINDS = new Set<string>(['add', 'change', 'unlink', 'addDir', 'unlinkDir'])

/** Watches a workspace and delivers changes in batches, deduplicated per path. */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null
  private pending = new Map<string, FsChangeKind>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly onChanges: (changes: FsChange[]) => void) {}

  start(root: string): void {
    void this.stop()
    this.watcher = watch(root, {
      ignoreInitial: true,
      ignored: (path) => IGNORED.test(path),
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 40 }
    })
    this.watcher.on('all', (event, path) => {
      if (!KINDS.has(event)) return
      this.pending.set(toRel(root, path), event as FsChangeKind)
      this.timer ??= setTimeout(() => this.flush(), FLUSH_MS)
    })
    this.watcher.on('error', (err) => log.warn('watch error', err))
  }

  private flush(): void {
    this.timer = null
    if (this.pending.size === 0) return
    const changes = [...this.pending].map(([path, kind]) => ({ path, kind }))
    this.pending.clear()
    this.onChanges(changes)
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
    const current = this.watcher
    this.watcher = null
    await current?.close()
  }
}
