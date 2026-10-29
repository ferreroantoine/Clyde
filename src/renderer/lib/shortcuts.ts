import { useEffect } from 'react'

export interface Shortcut {
  /** e.g. "ctrl+b", "ctrl+shift+e", "ctrl+alt+b", "ctrl+`" */
  combo: string
  run: () => void
}

function comboOf(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase())
  return parts.join('+')
}

/** Window-level shortcuts. Monaco and xterm keep their own bindings when focused. */
export function useShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const byCombo = new Map(shortcuts.map((s) => [s.combo, s.run]))
    const onKeyDown = (e: KeyboardEvent) => {
      const run = byCombo.get(comboOf(e))
      if (!run) return
      e.preventDefault()
      e.stopPropagation()
      run()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [shortcuts])
}
