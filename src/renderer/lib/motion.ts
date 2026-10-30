import { useEffect, useState } from 'react'
import type { Transition, Variants } from 'motion/react'
import type { AnimationLevel } from '@shared/settings'

/**
 * Motion design tokens. Every animation in the interface takes its timing from here, so the
 * whole app moves the same way: 150–300 ms, ease-out or damped springs, nothing that blocks
 * input (exit animations never delay what comes next).
 */
export const duration = {
  fast: 0.15,
  base: 0.2,
  slow: 0.3
} as const

/** Seconds, for CSS (`--motion-*` variables mirror these in globals.css). */
export const ease = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1]
} as const

export const spring = {
  /** Cards and list items: settles fast, no visible bounce. */
  soft: { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 },
  /** Things that should catch the eye a little: approvals, toasts. */
  pop: { type: 'spring', stiffness: 520, damping: 26, mass: 0.7 },
  /** Layout moves (reordering, stacking). */
  layout: { type: 'spring', stiffness: 500, damping: 40 }
} as const satisfies Record<string, Transition>

export const fadeOut: Transition = { duration: duration.fast, ease: ease.out }

/** Fade + a few pixels of slide: tool cards, messages, list items. */
export const enter: Variants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: spring.soft },
  gone: { opacity: 0, transition: fadeOut }
}

/** Views and tab panels swapping in place. */
export const swap: Variants = {
  hidden: { opacity: 0, y: 4 },
  shown: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } },
  gone: { opacity: 0, transition: { duration: duration.fast, ease: ease.out } }
}

/** Approval requests: a small pop that draws the eye without shouting. */
export const attention: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 4 },
  shown: { opacity: 1, scale: 1, y: 0, transition: spring.pop }
}

export const toast: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  shown: { opacity: 1, y: 0, scale: 1, transition: spring.pop },
  gone: { opacity: 0, x: 32, transition: { duration: duration.fast, ease: ease.out } }
}

/** A short shake for an error: a few pixels, 300 ms. */
export const shake = { x: [0, -4, 4, -3, 3, 0], transition: { duration: duration.slow, ease: ease.out } }

/** Icon swaps (spinner → check, check → cross). */
export const iconSwap: Variants = {
  hidden: { opacity: 0, scale: 0.5, rotate: -45 },
  shown: { opacity: 1, scale: 1, rotate: 0, transition: spring.pop },
  gone: { opacity: 0, scale: 0.5, transition: { duration: 0.1 } }
}

/** Delay of the n-th item that appears in the same batch: a short cascade, capped. */
export function cascade(index: number): number {
  return Math.min(index, 6) * 0.04
}

/**
 * The level that applies: the setting, lowered to `reduced` when the system asks for less
 * motion. `off` stays off.
 */
export function effectiveLevel(setting: AnimationLevel, systemReduced: boolean): AnimationLevel {
  if (setting === 'off') return 'off'
  return systemReduced ? 'reduced' : setting
}

const QUERY = '(prefers-reduced-motion: reduce)'

/** Follows the system "reduce motion" preference. */
export function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return reduced
}
