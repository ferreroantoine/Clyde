import { tk } from './i18n'

/**
 * Window-level keyboard shortcuts: their defaults, the user's changes (Settings › Keyboard
 * shortcuts) and conflicts. Combos are lower case, modifiers first in a fixed order:
 * "ctrl+alt+shift+key". Pure, tested.
 */

export interface KeyCommandSpec {
  id: string
  label: string
  defaultCombo: string
}

export const KEY_COMMANDS: KeyCommandSpec[] = [
  { id: 'view.palette', label: tk('Command palette'), defaultCombo: 'ctrl+k' },
  { id: 'view.paletteAlt', label: tk('Command palette (alternative)'), defaultCombo: 'ctrl+shift+p' },
  { id: 'file.quickOpen', label: tk('Go to file'), defaultCombo: 'ctrl+p' },
  { id: 'file.save', label: tk('Save file'), defaultCombo: 'ctrl+s' },
  { id: 'file.openFolder', label: tk('Open folder'), defaultCombo: 'ctrl+o' },
  { id: 'view.chat', label: tk('Show Chat'), defaultCombo: 'ctrl+shift+l' },
  { id: 'view.explorer', label: tk('Show Explorer'), defaultCombo: 'ctrl+shift+e' },
  { id: 'view.search', label: tk('Search in files'), defaultCombo: 'ctrl+shift+f' },
  { id: 'view.source', label: tk('Show Source control'), defaultCombo: 'ctrl+shift+g' },
  { id: 'view.settings', label: tk('Open Settings'), defaultCombo: 'ctrl+,' },
  { id: 'layout.sidebar', label: tk('Toggle sidebar'), defaultCombo: 'ctrl+b' },
  { id: 'layout.terminal', label: tk('Toggle terminal'), defaultCombo: 'ctrl+j' },
  { id: 'layout.terminalAlt', label: tk('Toggle terminal (alternative)'), defaultCombo: 'ctrl+`' },
  { id: 'layout.agentPanel', label: tk('Toggle agent panel'), defaultCombo: 'ctrl+alt+b' },
  { id: 'voice.toggle', label: tk('Start or stop dictation'), defaultCombo: 'ctrl+alt+d' }
]

/** Shortcuts Monaco uses in the editor; a window shortcut on the same keys would hide them. */
export const EDITOR_COMBOS: Record<string, string> = {
  'ctrl+f': tk('Find'),
  'ctrl+h': tk('Replace'),
  'ctrl+d': tk('Add selection to next match'),
  'ctrl+/': tk('Toggle line comment'),
  'ctrl+z': tk('Undo'),
  'ctrl+y': tk('Redo'),
  'ctrl+a': tk('Select all'),
  'ctrl+c': tk('Copy'),
  'ctrl+v': tk('Paste'),
  'ctrl+x': tk('Cut'),
  'ctrl+g': tk('Go to line'),
  'ctrl+l': tk('Expand line selection'),
  'ctrl+shift+k': tk('Delete line'),
  'ctrl+]': tk('Indent line'),
  'ctrl+[': tk('Outdent line'),
  'ctrl+space': tk('Trigger suggestion'),
  'ctrl+u': tk('Undo cursor'),
  'ctrl+i': tk('Trigger suggestion'),
  'alt+arrowup': tk('Move line up'),
  'alt+arrowdown': tk('Move line down'),
  'f1': tk('Command palette'),
  'f2': tk('Rename symbol'),
  'f12': tk('Go to definition')
}

/** The combo a key event stands for, in the canonical form. */
export function comboOf(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string }): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(e.key === ' ' ? 'space' : e.key.toLowerCase())
  return parts.join('+')
}

/** True for a combo made of modifiers only (still being typed). */
export function isModifierOnly(combo: string): boolean {
  return /(^|\+)(control|alt|shift|meta)$/.test(combo)
}

/** Each command's effective combo: the user's when set ("" turns the shortcut off), else the default. */
export function effectiveBindings(overrides: Record<string, string>): Record<string, string> {
  return Object.fromEntries(KEY_COMMANDS.map((c) => [c.id, c.id in overrides ? (overrides[c.id] as string) : c.defaultCombo]))
}

export interface Conflict {
  commandId: string
  combo: string
  /** Another command with the same combo, or an editor action. */
  with: { kind: 'command'; id: string } | { kind: 'editor'; action: string }
}

export function findConflicts(bindings: Record<string, string>): Conflict[] {
  const out: Conflict[] = []
  const entries = Object.entries(bindings).filter(([, combo]) => combo)
  for (const [id, combo] of entries) {
    for (const [other, otherCombo] of entries) {
      if (other !== id && otherCombo === combo) out.push({ commandId: id, combo, with: { kind: 'command', id: other } })
    }
    const action = EDITOR_COMBOS[combo]
    if (action) out.push({ commandId: id, combo, with: { kind: 'editor', action } })
  }
  return out
}

/** "Ctrl+Shift+P" for display. */
export function formatCombo(combo: string): string {
  if (!combo) return ''
  return combo
    .split('+')
    .map((p) => (p === 'ctrl' ? 'Ctrl' : p === 'alt' ? 'Alt' : p === 'shift' ? 'Shift' : p.length === 1 ? p.toUpperCase() : p[0]?.toUpperCase() + p.slice(1)))
    .join('+')
}
