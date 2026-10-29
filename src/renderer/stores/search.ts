import { create } from 'zustand'
import type { SearchMatch } from '@shared/types'
import { invoke } from '@/lib/ipc'

export interface FileMatches {
  path: string
  matches: SearchMatch[]
}

interface SearchState {
  query: string
  caseSensitive: boolean
  regex: boolean
  running: boolean
  results: FileMatches[]
  total: number
  truncated: boolean
  error: string | null
  setQuery: (query: string) => void
  toggleCase: () => void
  toggleRegex: () => void
  run: () => Promise<void>
  clear: () => void
}

const DEBOUNCE_MS = 250
let timer: ReturnType<typeof setTimeout> | null = null
let generation = 0

export function groupByFile(matches: SearchMatch[]): FileMatches[] {
  const byPath = new Map<string, SearchMatch[]>()
  for (const m of matches) {
    const list = byPath.get(m.path)
    if (list) list.push(m)
    else byPath.set(m.path, [m])
  }
  return [...byPath].map(([path, list]) => ({ path, matches: list }))
}

export const useSearch = create<SearchState>()((set, get) => {
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void get().run(), DEBOUNCE_MS)
  }

  return {
    query: '',
    caseSensitive: false,
    regex: false,
    running: false,
    results: [],
    total: 0,
    truncated: false,
    error: null,

    setQuery: (query) => {
      set({ query })
      schedule()
    },
    toggleCase: () => {
      set({ caseSensitive: !get().caseSensitive })
      schedule()
    },
    toggleRegex: () => {
      set({ regex: !get().regex })
      schedule()
    },

    run: async () => {
      const { query, caseSensitive, regex } = get()
      const current = ++generation
      if (!query.trim()) {
        set({ results: [], total: 0, truncated: false, error: null, running: false })
        return
      }
      set({ running: true, error: null })
      try {
        const result = await invoke('search:text', { query, caseSensitive, regex, maxResults: 2000 })
        if (current !== generation) return
        set({
          results: groupByFile(result.matches),
          total: result.matches.length,
          truncated: result.truncated,
          running: false
        })
      } catch (err) {
        if (current !== generation) return
        set({ running: false, results: [], total: 0, error: err instanceof Error ? err.message : String(err) })
      }
    },

    clear: () => {
      generation++
      set({ query: '', results: [], total: 0, truncated: false, error: null, running: false })
    }
  }
})
