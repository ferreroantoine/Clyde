import { describe, expect, it } from 'vitest'
import { comboOf, effectiveBindings, findConflicts, formatCombo } from './keybindings'

describe('keybindings', () => {
  it('normalizes key events', () => {
    expect(comboOf({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'P' })).toBe('ctrl+shift+p')
    expect(comboOf({ ctrlKey: false, metaKey: true, altKey: true, shiftKey: false, key: ' ' })).toBe('ctrl+alt+space')
    expect(formatCombo('ctrl+shift+p')).toBe('Ctrl+Shift+P')
  })

  it('applies overrides, including turning a shortcut off', () => {
    const b = effectiveBindings({ 'layout.sidebar': 'ctrl+alt+s', 'file.save': '' })
    expect(b['layout.sidebar']).toBe('ctrl+alt+s')
    expect(b['file.save']).toBe('')
    expect(b['view.palette']).toBe('ctrl+k')
  })

  it('finds duplicates and clashes with the editor', () => {
    const conflicts = findConflicts(effectiveBindings({ 'layout.sidebar': 'ctrl+k', 'layout.terminal': 'ctrl+f' }))
    expect(conflicts).toEqual(
      expect.arrayContaining([
        { commandId: 'layout.sidebar', combo: 'ctrl+k', with: { kind: 'command', id: 'view.palette' } },
        { commandId: 'view.palette', combo: 'ctrl+k', with: { kind: 'command', id: 'layout.sidebar' } },
        { commandId: 'layout.terminal', combo: 'ctrl+f', with: { kind: 'editor', action: 'Find' } }
      ])
    )
    expect(findConflicts(effectiveBindings({}))).toEqual([])
  })
})
