import { create } from 'zustand'

export type PaletteMode = 'all' | 'files'

interface PaletteState {
  open: boolean
  mode: PaletteMode
  show: (mode?: PaletteMode) => void
  hide: () => void
}

export const usePalette = create<PaletteState>()((set) => ({
  open: false,
  mode: 'all',
  show: (mode = 'all') => set({ open: true, mode }),
  hide: () => set({ open: false })
}))
