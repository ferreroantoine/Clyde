import { useCallback, useEffect, useState } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { PANEL_ANIMATION_MS, PanelSync } from './panel-sync'

/**
 * Two-way binding between a collapsible panel and a boolean in the layout store:
 * store changes collapse/expand the panel, and dragging it shut updates the store.
 */
export function usePanelSync(open: boolean, setOpen: (open: boolean) => void) {
  const panelRef = usePanelRef()
  // `setOpen` is a store action: the same function for the app's lifetime.
  const [sync] = useState(() => new PanelSync(setOpen, animatePanels))

  useEffect(() => () => sync.dispose(), [sync])

  useEffect(() => {
    const panel = panelRef.current
    if (panel) sync.apply(panel, open)
  }, [open, panelRef, sync])

  const onResize = useCallback(() => {
    const panel = panelRef.current
    if (panel) sync.resized(panel, open)
  }, [open, panelRef, sync])

  return { panelRef, onResize }
}

let animationTimer: ReturnType<typeof setTimeout> | undefined

/** Animates the size change (CSS transition on flex-grow) only for toggles, never while dragging. */
function animatePanels(): void {
  const root = document.documentElement
  root.dataset['panelsAnimating'] = ''
  clearTimeout(animationTimer)
  animationTimer = setTimeout(() => delete root.dataset['panelsAnimating'], PANEL_ANIMATION_MS)
}
