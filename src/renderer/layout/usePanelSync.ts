import { useCallback, useEffect } from 'react'
import { usePanelRef, type PanelSize } from 'react-resizable-panels'

/**
 * Two-way binding between a collapsible panel and a boolean in the layout store:
 * store changes collapse/expand the panel, and dragging it shut updates the store.
 */
export function usePanelSync(open: boolean, setOpen: (open: boolean) => void) {
  const panelRef = usePanelRef()

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (open && panel.isCollapsed()) panel.expand()
    if (!open && !panel.isCollapsed()) panel.collapse()
  }, [open, panelRef])

  const onResize = useCallback(
    (size: PanelSize) => {
      const nowOpen = size.inPixels > 0
      if (nowOpen !== open) setOpen(nowOpen)
    },
    [open, setOpen]
  )

  return { panelRef, onResize }
}
