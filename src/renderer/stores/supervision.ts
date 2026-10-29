import { create } from 'zustand'
import type { Dashboard, MetricsRange, SessionTranscript } from '@shared/metrics'
import type { PriceInput, PriceRow } from '@shared/pricing'
import { invoke } from '@/lib/ipc'
import { notify } from './notifications'

interface SupervisionState {
  range: MetricsRange
  dashboard: Dashboard | null
  loading: boolean
  transcript: SessionTranscript | null
  prices: PriceRow[]
  load: (range?: MetricsRange) => Promise<void>
  openTranscript: (sessionId: string) => Promise<void>
  closeTranscript: () => void
  loadPrices: () => Promise<void>
  savePrice: (input: PriceInput & { id?: string }) => Promise<boolean>
  deletePrice: (id: string) => Promise<void>
}

export const useSupervision = create<SupervisionState>()((set, get) => ({
  range: '7d',
  dashboard: null,
  loading: false,
  transcript: null,
  prices: [],

  load: async (range = get().range) => {
    set({ range, loading: true })
    try {
      set({ dashboard: await invoke('metrics:dashboard', { range }) })
    } catch (err) {
      notify.error('Could not load the dashboard', err)
    } finally {
      set({ loading: false })
    }
  },

  openTranscript: async (sessionId) => {
    try {
      set({ transcript: await invoke('metrics:transcript', { sessionId }) })
    } catch (err) {
      notify.error('Could not open this session', err)
    }
  },

  closeTranscript: () => set({ transcript: null }),

  loadPrices: async () => {
    try {
      set({ prices: await invoke('pricing:list') })
    } catch (err) {
      notify.error('Could not load prices', err)
    }
  },

  savePrice: async (input) => {
    try {
      set({ prices: await invoke('pricing:save', input) })
      return true
    } catch (err) {
      notify.error('Could not save the price', err)
      return false
    }
  },

  deletePrice: async (id) => {
    try {
      set({ prices: await invoke('pricing:delete', { id }) })
    } catch (err) {
      notify.error('Could not delete the price', err)
    }
  }
}))
