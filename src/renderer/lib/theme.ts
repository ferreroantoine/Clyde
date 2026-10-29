import { useEffect } from 'react'
import { create } from 'zustand'
import type { Settings } from '@shared/settings'

export type ResolvedTheme = 'light' | 'dark'

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function resolveTheme(theme: Settings['theme']): ResolvedTheme {
  if (theme === 'system') return media().matches ? 'dark' : 'light'
  return theme
}

/**
 * Resolves a CSS color token (oklch etc.) to #rrggbb for libraries that only parse hex,
 * such as xterm. Painting through a canvas lets the browser do the conversion.
 */
export function tokenToHex(token: string): string | null {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  if (!value) return null
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
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
