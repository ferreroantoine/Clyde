import { comboOf } from '@shared/keybindings'
import { useEffect } from 'react'

export interface Shortcut {
  /** e.g. "ctrl+b", "ctrl+shift+e", "ctrl+alt+b", "ctrl+`" */
  combo: string
  run: () => void
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
