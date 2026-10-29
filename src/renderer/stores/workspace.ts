import { create } from 'zustand'
import type { WorkspaceInfo } from '@shared/types'
import { invoke, on } from '@/lib/ipc'
import { notify } from './notifications'
import { useExplorer } from './explorer'
import { useEditor } from './editor'
import { useTerminals } from './terminals'

interface WorkspaceState {
  info: WorkspaceInfo | null
  ready: boolean
  init: () => Promise<() => void>
  pick: () => Promise<void>
  open: (root: string) => Promise<void>
}

function onWorkspaceChanged(info: WorkspaceInfo | null, previous: WorkspaceInfo | null) {
  if (info?.root === previous?.root) return
  useEditor.getState().closeAll()
  useExplorer.getState().reset()
  if (info) {
    void useExplorer.getState().loadDir('')
    void useTerminals.getState().workspaceChanged(info.root)
  }
}

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  info: null,
  ready: false,

  /** Loads the current workspace and subscribes to main-process events. Returns the unsubscribe. */
  init: async () => {
    const offs = [
      on('workspace:changed', (info) => {
        const previous = get().info
        set({ info })
        onWorkspaceChanged(info, previous)
      }),
      on('fs:changed', (changes) => {
        useExplorer.getState().applyFsChanges(changes)
        useEditor.getState().applyFsChanges(changes)
      })
    ]
    try {
      const info = await invoke('workspace:current')
      set({ info, ready: true })
      onWorkspaceChanged(info, null)
    } catch (err) {
      set({ ready: true })
      notify.error('Could not read the current workspace', err)
    }
    return () => offs.forEach((off) => off())
  },

  pick: async () => {
    try {
      await invoke('workspace:pick')
    } catch (err) {
      notify.error('Could not open folder', err)
    }
  },

  open: async (root) => {
    try {
      await invoke('workspace:open', { root })
    } catch (err) {
      notify.error('Could not open folder', err)
    }
  }
}))
