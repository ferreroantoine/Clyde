import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { DirEntry, FsChange } from '@shared/types'
import { invoke } from '@/lib/ipc'
import { notify } from './notifications'

interface ExplorerState {
  /** Loaded directory listings keyed by relative path ('' is the root). */
  children: Record<string, DirEntry[]>
  expanded: Record<string, boolean>
  selected: string | null
  reset: () => void
  loadDir: (path: string) => Promise<void>
  toggle: (path: string) => void
  select: (path: string | null) => void
  collapseAll: () => void
  refresh: () => Promise<void>
  applyFsChanges: (changes: FsChange[]) => void
}

export const parentOf = (path: string) => {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

const isUnder = (path: string, dir: string) => path === dir || path.startsWith(dir + '/')

const without = <T,>(record: Record<string, T>, drop: (key: string) => boolean): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !drop(key)))

export const useExplorer = create<ExplorerState>()((set, get) => ({
  children: {},
  expanded: {},
  selected: null,

  reset: () => set({ children: {}, expanded: {}, selected: null }),

  loadDir: async (path) => {
    try {
      const entries = await invoke('fs:list', { path })
      set({ children: { ...get().children, [path]: entries } })
    } catch (err) {
      if ((err as { code?: string }).code === 'not_found') {
        set({ children: without(get().children, (key) => key === path) })
      } else {
        notify.error(path ? t('Could not read {path}', { path }) : t('Could not read the folder'), err)
      }
    }
  },

  toggle: (path) => {
    const open = !get().expanded[path]
    set({ expanded: { ...get().expanded, [path]: open } })
    if (open && !get().children[path]) void get().loadDir(path)
  },

  select: (path) => set({ selected: path }),

  collapseAll: () => set({ expanded: {} }),

  refresh: async () => {
    const dirs = Object.keys(get().children)
    await Promise.all(dirs.map((d) => get().loadDir(d)))
  },

  applyFsChanges: (changes) => {
    const { children } = get()
    const reload = new Set<string>()
    let pruned: Record<string, DirEntry[]> | null = null
    for (const { kind, path } of changes) {
      if (kind === 'unlinkDir') pruned = without(pruned ?? children, (key) => isUnder(key, path))
      if (kind === 'add' || kind === 'unlink' || kind === 'addDir' || kind === 'unlinkDir') {
        const parent = parentOf(path)
        if (children[parent]) reload.add(parent)
      }
    }
    if (pruned) set({ children: pruned })
    for (const dir of reload) void get().loadDir(dir)
  }
}))
