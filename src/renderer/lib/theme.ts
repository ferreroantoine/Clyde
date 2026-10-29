import { useEffect } from 'react'
import { create } from 'zustand'
import type { Settings } from '@shared/settings'

export type ResolvedTheme = 'light' | 'dark'

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function resolveTheme(theme: Settings['theme']): ResolvedTheme {
  if (theme === 'system') return media().matches ? 'dark' : 'light'
  return theme
}

/** The theme actually on screen, read by Monaco and xterm. */
export const useResolvedTheme = create<{ theme: ResolvedTheme }>()(() => ({ theme: 'light' }))

/** Keeps the `dark` class on <html> in sync with the setting (and the OS when set to system). */
export function useApplyTheme(theme: Settings['theme']): void {
  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(theme)
      document.documentElement.classList.toggle('dark', next === 'dark')
      document.documentElement.style.colorScheme = next
      useResolvedTheme.setState({ theme: next })
    }
    apply()
    if (theme !== 'system') return
    const mq = media()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}
