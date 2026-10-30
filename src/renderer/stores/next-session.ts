import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { NextSession } from '@/lib/next-session'

interface NextSessionState {
  /** The last choice of the agent panel, by project root ('' without a folder). */
  byProject: Record<string, NextSession>
  save: (root: string, next: NextSession) => void
}

export const useNextSession = create<NextSessionState>()(
  persist(
    (set) => ({
      byProject: {},
      save: (root, next) => set((s) => ({ byProject: { ...s.byProject, [root]: next } }))
    }),
    { name: 'clyde.nextSession' }
  )
)
