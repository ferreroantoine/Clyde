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

/**
 * The dictation shortcut: a press toggles dictation, or, in "hold" mode, dictation lasts
 * while the keys are held (released keys stop it). Captured before Monaco and xterm.
 */
export function useDictationShortcut(combo: string | undefined, hold: boolean, actions: { start: () => void; stop: () => void; toggle: () => void }): void {
  useEffect(() => {
    if (!combo) return
    let holding = false
    const onKeyDown = (e: KeyboardEvent) => {
      if (comboOf(e) !== combo) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (hold) {
        holding = true
        actions.start()
      } else actions.toggle()
    }
    const onKeyUp = () => {
      if (!holding) return
      holding = false
      actions.stop()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
    }
  }, [combo, hold, actions])
}
