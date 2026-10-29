import { create } from 'zustand'
import type { WorkspaceInfo } from '@shared/types'

interface WorkspaceState {
  info: WorkspaceInfo | null
}

export const useWorkspace = create<WorkspaceState>()(() => ({ info: null }))
