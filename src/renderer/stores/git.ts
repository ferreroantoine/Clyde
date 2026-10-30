import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { FileSession, GitBranch, GitCheckpoint, GitCommit, GitDiffMode, GitFileState, GitResult, GitStash, GitStatus } from '@shared/git'
import { invoke, on } from '@/lib/ipc'
import { notify } from './notifications'
import { useWorkspace } from './workspace'
import { useExplorer } from './explorer'
import { useEditor } from './editor'
import { useLayout } from './layout'

/** What the editor area shows instead of a file: one change, or one commit. */
export type GitView =
  | { kind: 'change'; path: string; mode: GitDiffMode; oldPath: string | null }
  | { kind: 'commit'; commit: GitCommit; path: string | null }

const REFRESH_MS = 350
const LOG_PAGE = 300

interface GitState {
  status: GitStatus | null
  branches: GitBranch[]
  stashes: GitStash[]
  checkpoints: GitCheckpoint[]
  /** Agent sessions that wrote each file (repository-relative). */
  fileSessions: Record<string, FileSession[]>
  commits: GitCommit[]
  logAll: boolean
  logLoaded: boolean
  logEnd: boolean
  message: string
  amend: boolean
  /** The operation running (commit, push…), to disable buttons and show a spinner. */
  busy: string | null
  generating: boolean
  view: GitView | null
  /** Explorer decorations, by open-folder path. */
  decorations: Record<string, GitFileState>
  /** Folders (open-folder paths) holding changes. */
  dirtyDirs: Record<string, true>
  ignored: Record<string, true>

  init: () => () => void
  refresh: () => Promise<void>
  loadLog: (more?: boolean) => Promise<void>
  setLogAll: (all: boolean) => void
  setMessage: (message: string) => void
  setAmend: (amend: boolean) => Promise<void>
  show: (view: GitView | null) => void
  run: <T>(busy: string, failure: string, action: () => Promise<T>) => Promise<T | undefined>
  /** Shows a merge, pull or stash outcome; conflicts get a warning. */
  report: (result: GitResult | undefined, success?: string) => void
  commit: (push?: boolean) => Promise<void>
  generateMessage: () => Promise<void>
  checkIgnored: (paths: string[]) => Promise<void>
  /** The open-folder path of a repository path, or null when it is outside the open folder. */
  toWorkspace: (path: string) => string | null
}

function decorationsOf(status: GitStatus | null): Pick<GitState, 'decorations' | 'dirtyDirs'> {
  const decorations: Record<string, GitFileState> = {}
  const dirtyDirs: Record<string, true> = {}
  if (!status?.isRepo) return { decorations, dirtyDirs }
  const prefix = status.prefix
  // Later lists win: a conflict over a change, a change over a staged state.
  for (const change of [...status.staged, ...status.untracked, ...status.unstaged, ...status.conflicts]) {
    if (!change.path.startsWith(prefix)) continue
    const path = change.path.slice(prefix.length)
    decorations[path] = change.state
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) dirtyDirs[parts.slice(0, i).join('/')] = true
  }
  return { decorations, dirtyDirs }
}

export const useGit = create<GitState>()((set, get) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let refreshing: Promise<void> | null = null
  let again = false
  const later = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void get().refresh()
    }, REFRESH_MS)
  }
  const loadSessions = () => {
    invoke('git:fileSessions')
      .then((fileSessions) => set({ fileSessions }))
      .catch(() => undefined)
  }

  return {
    status: null,
    branches: [],
    stashes: [],
    checkpoints: [],
    fileSessions: {},
    commits: [],
    logAll: false,
    logLoaded: false,
    logEnd: false,
    message: '',
    amend: false,
    busy: null,
    generating: false,
    view: null,
    decorations: {},
    dirtyDirs: {},
    ignored: {},

    init: () => {
      const offs = [
        on('git:changed', later),
        on('fs:changed', later),
        // Files an agent writes show its session.
        on('agent:event', ({ event }) => {
          if (event.type === 'turn_end') loadSessions()
        }),
        useWorkspace.subscribe((state, previous) => {
          if (state.info?.root === previous.info?.root) return
          set({ status: null, commits: [], logLoaded: false, view: null, ignored: {}, message: '', amend: false, ...decorationsOf(null) })
          later()
        }),
        // Explorer entries get greyed out when git ignores them.
        useExplorer.subscribe((state, previous) => {
          if (state.children === previous.children) return
          const fresh = Object.entries(state.children).filter(([dir, list]) => previous.children[dir] !== list)
          const paths = fresh.flatMap(([, list]) => list.map((e) => e.path))
          if (paths.length) void get().checkIgnored(paths)
        }),
        // Opening a file leaves the diff.
        useEditor.subscribe((state, previous) => {
          if (state.active !== previous.active && state.active && get().view) set({ view: null })
        })
      ]
      const onFocus = () => later()
      window.addEventListener('focus', onFocus)
      void get().refresh()
      return () => {
        offs.forEach((off) => off())
        window.removeEventListener('focus', onFocus)
        if (timer) clearTimeout(timer)
      }
    },

    refresh: async () => {
      if (refreshing) {
        again = true
        return refreshing
      }
      refreshing = (async () => {
        try {
          if (!useWorkspace.getState().info) {
            set({ status: null, ...decorationsOf(null) })
            return
          }
          const first = !get().status?.isRepo
          const status = await invoke('git:status')
          set({ status, ...decorationsOf(status) })
          // The explorer loaded before git answered: its entries are checked now.
          if (first && status.isRepo) void get().checkIgnored(Object.values(useExplorer.getState().children).flatMap((list) => list.map((e) => e.path)))
          if (!status.isRepo) {
            set({ branches: [], stashes: [], checkpoints: [], fileSessions: {}, commits: [] })
            return
          }
          const [branches, stashes, checkpoints] = await Promise.all([invoke('git:branches'), invoke('git:stashes'), invoke('git:checkpoints')])
          set({ branches, stashes, checkpoints })
          loadSessions()
          if (get().logLoaded) await get().loadLog()
        } catch {
          // The view keeps what it had; the next change retries.
        }
      })()
      try {
        await refreshing
      } finally {
        refreshing = null
        if (again) {
          again = false
          later()
        }
      }
    },

    loadLog: async (more = false) => {
      try {
        const skip = more ? get().commits.length : 0
        const page = await invoke('git:log', { all: get().logAll, limit: LOG_PAGE, skip })
        set({ commits: more ? [...get().commits, ...page] : page, logLoaded: true, logEnd: page.length < LOG_PAGE })
      } catch (err) {
        notify.error(t('Could not read the history'), err)
      }
    },

    setLogAll: (logAll) => {
      set({ logAll })
      void get().loadLog()
    },

    setMessage: (message) => set({ message }),

    setAmend: async (amend) => {
      set({ amend })
      // Amending starts from the last commit's message, when nothing was typed.
      if (amend && !get().message.trim()) {
        const last = await invoke('git:lastMessage').catch(() => '')
        if (get().amend && !get().message.trim()) set({ message: last })
      }
    },

    show: (view) => {
      set({ view })
      if (view) useLayout.getState().showCenter('editor')
    },

    run: async (busy, failure, action) => {
      set({ busy })
      try {
        return await action()
      } catch (err) {
        notify.error(failure, err)
        return undefined
      } finally {
        set({ busy: null })
        void get().refresh()
      }
    },

    report: (result, success) => {
      if (!result) return
      if (result.ok) {
        if (success) notify.success(success)
      } else {
        notify.warning(result.message || t('git stopped'), result.conflicts.length ? result.conflicts.slice(0, 8).join('\n') : undefined)
      }
    },

    commit: async (push = false) => {
      const { message, amend, status } = get()
      if (!message.trim()) {
        notify.warning(t('Write a commit message first'))
        return
      }
      // Nothing staged: everything is committed, as VS Code offers.
      const stageAll = !amend && status && status.staged.length === 0
      if (stageAll) {
        const count = status.unstaged.length + status.untracked.length
        if (count === 0 && !status.operation) {
          notify.warning(t('Nothing to commit'))
          return
        }
        if (count > 0 && !window.confirm(t('No changes are staged. Stage all {count} changes and commit them?', { count }))) return
      }
      const hash = await get().run(push ? 'commit-push' : 'commit', t('Could not commit'), async () => {
        if (stageAll) await invoke('git:stageAll')
        return invoke('git:commit', { message, amend, push })
      })
      if (hash) {
        set({ message: '', amend: false })
        notify.success(push ? t('Committed and pushed {hash}', { hash: hash.slice(0, 7) }) : t('Committed {hash}', { hash: hash.slice(0, 7) }))
      }
    },

    generateMessage: async () => {
      set({ generating: true })
      try {
        const status = get().status
        // Like the commit button: without staged changes, the message describes them all.
        if (status && status.staged.length === 0 && status.unstaged.length + status.untracked.length > 0) {
          if (!window.confirm(t('No changes are staged. Stage everything to write the message?'))) return
          await invoke('git:stageAll')
        }
        set({ message: await invoke('git:generateMessage') })
      } catch (err) {
        notify.error(t('Could not write the commit message'), err)
      } finally {
        set({ generating: false })
        void get().refresh()
      }
    },

    checkIgnored: async (paths) => {
      if (!get().status?.isRepo) return
      try {
        const ignored = await invoke('git:ignored', { paths })
        const checked = new Set(paths)
        const kept = Object.entries(get().ignored).filter(([p]) => !checked.has(p))
        set({ ignored: Object.fromEntries([...kept, ...ignored.map((p) => [p, true] as const)]) })
      } catch {
        // Decorations only.
      }
    },

    toWorkspace: (path) => {
      const prefix = get().status?.prefix ?? ''
      if (!prefix) return path
      return path.startsWith(prefix) ? path.slice(prefix.length) : null
    }
  }
})
