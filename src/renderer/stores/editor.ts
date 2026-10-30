import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { FsChange } from '@shared/types'
import { invoke } from '@/lib/ipc'
import { disposeModel, getModel, languageFor, upsertModel } from '@/lib/monaco/models'
import { notify } from './notifications'
import { useLayout } from './layout'
import { useExplorer } from './explorer'
import { afterClose, ancestors, visit } from '@/lib/tab-history'
import { hasTextPreview, isBinaryViewer, viewerFor, type ViewerKind } from '@/lib/viewers'

export interface EditorTab {
  path: string
  name: string
  language: string
  status: 'loading' | 'ready' | 'unsupported' | 'error'
  unsupported?: 'binary' | 'too-large'
  /** Who shows it (see lib/viewers.ts). */
  viewer: ViewerKind
  /** The text is in a Monaco model (false for images, PDF… and tables too large for the editor). */
  hasText: boolean
  /** For text with a preview: which of the two is on screen. */
  mode: 'preview' | 'code'
  size?: number
  mtimeMs?: number
  error?: string
  dirty: boolean
  /** Set when the file changed or vanished on disk while it has unsaved edits. */
  conflict?: 'modified' | 'deleted'
}

export interface Reveal {
  path: string
  line: number
  column: number
  length?: number
}

interface EditorState {
  tabs: EditorTab[]
  active: string | null
  reveal: Reveal | null
  cursor: { line: number; column: number } | null
  open: (path: string, reveal?: Omit<Reveal, 'path'>) => Promise<void>
  activate: (path: string) => void
  close: (path: string) => void
  closeAll: () => void
  save: (path?: string) => Promise<void>
  reloadFromDisk: (path: string) => Promise<void>
  applyFsChanges: (changes: FsChange[]) => void
  /** A file or folder was renamed from the explorer: its open tabs follow, unsaved edits included. */
  moved: (from: string, to: string) => void
  /** A file or folder was deleted from the explorer: its tabs without unsaved edits close. */
  removed: (path: string) => void
  /** Switches a Markdown, SVG, table or JSON tab between its preview and the code. */
  setMode: (path: string, mode: 'preview' | 'code') => void
  consumeReveal: () => void
  setCursor: (cursor: { line: number; column: number } | null) => void
}

// Per-model bookkeeping kept outside React state: saved version ids and listeners.
const savedVersion = new Map<string, number>()
const listeners = new Map<string, { dispose(): void }>()
/** Paths we just wrote, so the watcher echo of our own save is not mistaken for an external edit. */
const ownWrites = new Map<string, number>()
const OWN_WRITE_WINDOW_MS = 2000

const nameOf = (path: string) => path.split('/').pop() ?? path

/** Runs before the active file is saved, e.g. "format on save"; set by the editor host. */
export const saveHooks: { beforeSave: ((path: string) => Promise<void>) | null } = { beforeSave: null }

export const useEditor = create<EditorState>()((set, get) => {
  const patch = (path: string, update: Partial<EditorTab>) =>
    set({ tabs: get().tabs.map((t) => (t.path === path ? { ...t, ...update } : t)) })

  const track = (path: string) => {
    const model = getModel(path)
    if (!model) return
    savedVersion.set(path, model.getAlternativeVersionId())
    listeners.get(path)?.dispose()
    listeners.set(
      path,
      model.onDidChangeContent(() => {
        const dirty = model.getAlternativeVersionId() !== savedVersion.get(path)
        const tab = get().tabs.find((t) => t.path === path)
        if (tab && tab.dirty !== dirty) patch(path, { dirty })
      })
    )
  }

  const load = async (path: string) => {
    const viewer = viewerFor(path)
    try {
      // Images, PDF, media and documents: their viewer reads the bytes through clyde-file://.
      if (isBinaryViewer(viewer)) {
        const info = await invoke('fs:stat', { path })
        patch(path, { status: 'ready', hasText: false, ...info })
        return
      }
      const file = await invoke('fs:read', { path })
      const info = { size: file.size, mtimeMs: file.mtimeMs }
      if (file.unsupported) {
        // A table too large for the editor still shows its first rows.
        if (viewer === 'table' && file.unsupported === 'too-large') patch(path, { status: 'ready', hasText: false, ...info })
        else patch(path, { status: 'unsupported', unsupported: file.unsupported, ...info })
        return
      }
      upsertModel(path, file.content)
      track(path)
      patch(path, { status: 'ready', hasText: true, dirty: false, conflict: undefined, ...info })
    } catch (err) {
      patch(path, { status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  const release = (path: string) => {
    listeners.get(path)?.dispose()
    listeners.delete(path)
    savedVersion.delete(path)
    disposeModel(path)
  }

  // Tabs in the order they were looked at, most recent last.
  let history: string[] = []

  /** Makes `path` the tab on screen; the explorer selects (and reveals) the same file, or nothing. */
  const show = (path: string | null) => {
    if (path) history = visit(history, path)
    const explorer = useExplorer.getState()
    explorer.select(path)
    if (path) explorer.reveal(ancestors(path))
  }

  return {
    tabs: [],
    active: null,
    reveal: null,
    cursor: null,

    open: async (path, reveal) => {
      useLayout.getState().showCenter('editor')
      const existing = get().tabs.find((t) => t.path === path)
      set({ active: path, reveal: reveal ? { path, ...reveal } : null })
      show(path)
      // Going to a line (a search result, a link to a symbol) needs the code, not the preview.
      if (existing) {
        if (reveal && existing.mode === 'preview') patch(path, { mode: 'code' })
        return
      }
      const viewer = viewerFor(path)
      const mode = hasTextPreview(viewer) && !reveal ? 'preview' : 'code'
      const tab: EditorTab = { path, name: nameOf(path), language: languageFor(path), status: 'loading', dirty: false, viewer, hasText: false, mode }
      set({ tabs: [...get().tabs, tab] })
      await load(path)
    },

    activate: (path) => {
      set({ active: path })
      show(path)
    },

    close: (path) => {
      const { tabs, active } = get()
      const index = tabs.findIndex((t) => t.path === path)
      const tab = tabs[index]
      if (!tab) return
      if (tab.dirty && !window.confirm(t('{name} has unsaved changes. Close it anyway?', { name: tab.name }))) return
      release(path)
      const rest = tabs.filter((t) => t.path !== path)
      const nextActive = afterClose(history, tabs.map((t) => t.path), path, active)
      history = history.filter((p) => p !== path)
      set({ tabs: rest, active: nextActive, ...(nextActive ? {} : { cursor: null }) })
      if (nextActive !== active) show(nextActive)
    },

    closeAll: () => {
      for (const tab of get().tabs) release(tab.path)
      history = []
      set({ tabs: [], active: null, reveal: null, cursor: null })
      useExplorer.getState().select(null)
    },

    save: async (path) => {
      const target = path ?? get().active
      const model = target ? getModel(target) : null
      if (!target || !model) return
      if (target === get().active) await saveHooks.beforeSave?.(target).catch(() => undefined)
      const version = model.getAlternativeVersionId()
      try {
        ownWrites.set(target, Date.now())
        await invoke('fs:write', { path: target, content: model.getValue() })
        savedVersion.set(target, version)
        patch(target, { dirty: model.getAlternativeVersionId() !== version, conflict: undefined })
      } catch (err) {
        notify.error(t('Could not save {name}', { name: nameOf(target) }), err)
      }
    },

    reloadFromDisk: async (path) => {
      patch(path, { status: 'loading' })
      await load(path)
    },

    applyFsChanges: (changes) => {
      for (const change of changes) {
        const tab = get().tabs.find((t) => t.path === change.path)
        if (!tab) continue
        if (change.kind === 'unlink') {
          patch(tab.path, { conflict: 'deleted' })
        } else if (change.kind === 'change' || change.kind === 'add') {
          const wroteAt = ownWrites.get(tab.path)
          if (wroteAt !== undefined && Date.now() - wroteAt < OWN_WRITE_WINDOW_MS) continue
          ownWrites.delete(tab.path)
          if (tab.dirty) patch(tab.path, { conflict: 'modified' })
          else void load(tab.path)
        }
      }
    },

    moved: (from, to) => {
      const target = (path: string) => (path === from ? to : path.startsWith(from + '/') ? to + path.slice(from.length) : null)
      const renamed: Array<[string, string]> = []
      for (const tab of get().tabs) {
        const next = target(tab.path)
        if (!next) continue
        const edits = tab.dirty ? getModel(tab.path)?.getValue() : undefined
        release(tab.path)
        if (edits !== undefined) {
          upsertModel(next, edits)
          track(next)
          savedVersion.set(next, -1)
        }
        renamed.push([tab.path, next])
      }
      if (renamed.length === 0) return
      const map = new Map(renamed)
      history = history.map((p) => map.get(p) ?? p)
      const active = get().active
      set({
        tabs: get().tabs.map((tab) => {
          const next = map.get(tab.path)
          if (!next) return tab
          const viewer = viewerFor(next)
          return { ...tab, path: next, name: nameOf(next), language: languageFor(next), viewer, ...(viewer !== tab.viewer ? { mode: hasTextPreview(viewer) ? 'preview' : 'code' } : {}) }
        }),
        active: active ? (map.get(active) ?? active) : null
      })
      // Tabs without unsaved edits reload from their new path.
      for (const [, next] of renamed) {
        if (getModel(next) || get().tabs.find((t) => t.path === next)?.status !== 'ready') continue
        patch(next, { status: 'loading' })
        void load(next)
      }
      if (active && map.has(active)) show(map.get(active) ?? null)
    },

    removed: (path) => {
      for (const tab of get().tabs) {
        if (tab.path !== path && !tab.path.startsWith(path + '/')) continue
        if (tab.dirty) patch(tab.path, { conflict: 'deleted' })
        else get().close(tab.path)
      }
    },

    setMode: (path, mode) => patch(path, { mode }),
    consumeReveal: () => set({ reveal: null }),
    setCursor: (cursor) => set({ cursor })
  }
})
