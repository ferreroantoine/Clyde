import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PANEL_ANIMATION_MS, PanelSync, type CollapsiblePanel } from './panel-sync'

function fakePanel(collapsed: boolean): CollapsiblePanel & { collapsed: boolean } {
  return {
    collapsed,
    isCollapsed() {
      return this.collapsed
    },
    collapse() {
      this.collapsed = true
    },
    expand() {
      this.collapsed = false
    }
  }
}

describe('PanelSync', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('closes on a store toggle without the animation reopening it', () => {
    const setOpen = vi.fn()
    const onToggle = vi.fn()
    const sync = new PanelSync(setOpen, onToggle)
    const panel = fakePanel(false)
    sync.apply(panel, false)
    expect(panel.collapsed).toBe(true)
    expect(onToggle).toHaveBeenCalledOnce()
    // The transition reports the shrinking sizes; the store keeps "closed".
    sync.resized(panel, false)
    vi.advanceTimersByTime(PANEL_ANIMATION_MS / 2)
    sync.resized(panel, false)
    vi.advanceTimersByTime(PANEL_ANIMATION_MS)
    sync.resized(panel, false)
    expect(setOpen).not.toHaveBeenCalled()
  })

  it('closes and opens twice in a row', () => {
    const setOpen = vi.fn()
    const sync = new PanelSync(setOpen)
    const panel = fakePanel(false)
    for (const open of [false, true, false, true]) {
      sync.apply(panel, open)
      sync.resized(panel, open)
      expect(panel.collapsed).toBe(!open)
    }
    expect(setOpen).not.toHaveBeenCalled()
  })

  it('does nothing when the panel already matches the store', () => {
    const onToggle = vi.fn()
    const sync = new PanelSync(vi.fn(), onToggle)
    const panel = fakePanel(true)
    sync.apply(panel, false)
    expect(onToggle).not.toHaveBeenCalled()
    expect(panel.collapsed).toBe(true)
  })

  it('updates the store when the panel is dragged shut or open', () => {
    const setOpen = vi.fn()
    const sync = new PanelSync(setOpen)
    const panel = fakePanel(false)
    panel.collapsed = true
    sync.resized(panel, true)
    expect(setOpen).toHaveBeenLastCalledWith(false)
    panel.collapsed = false
    sync.resized(panel, false)
    expect(setOpen).toHaveBeenLastCalledWith(true)
  })

  it('follows drags again once the toggle animation is over', () => {
    const setOpen = vi.fn()
    const sync = new PanelSync(setOpen)
    const panel = fakePanel(false)
    sync.apply(panel, false)
    vi.advanceTimersByTime(PANEL_ANIMATION_MS)
    panel.collapsed = false
    sync.resized(panel, false)
    expect(setOpen).toHaveBeenCalledWith(true)
  })
})
