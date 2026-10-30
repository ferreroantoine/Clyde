/** What the sync needs from a react-resizable-panels panel. */
export interface CollapsiblePanel {
  isCollapsed(): boolean
  collapse(): void
  expand(): void
}

/** Length of the open/close animation (the flex-grow transition in globals.css, with a margin). */
export const PANEL_ANIMATION_MS = 260

/**
 * Keeps a collapsible panel and a boolean in the layout store in step, both ways.
 *
 * The panel's resize events report its size in pixels as the CSS transition plays: right
 * after a collapse it still measures more than 0 px. Read as "open", that would reopen the
 * panel the store just closed. So during a commanded toggle resizes are ignored, and open
 * or closed is read from the panel's layout (`isCollapsed`), which changes at once.
 */
export class PanelSync {
  private toggling: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly setOpen: (open: boolean) => void,
    private readonly onToggle: () => void = () => undefined
  ) {}

  /** The store says `open`: collapse or expand the panel if it differs. */
  apply(panel: CollapsiblePanel, open: boolean): void {
    if (open === !panel.isCollapsed()) return
    clearTimeout(this.toggling)
    this.toggling = setTimeout(() => (this.toggling = undefined), PANEL_ANIMATION_MS)
    this.onToggle()
    if (open) panel.expand()
    else panel.collapse()
  }

  /** The panel was resized: by a drag, or by the animation of a toggle. */
  resized(panel: CollapsiblePanel, open: boolean): void {
    if (this.toggling !== undefined) return
    const nowOpen = !panel.isCollapsed()
    if (nowOpen !== open) this.setOpen(nowOpen)
  }

  dispose(): void {
    clearTimeout(this.toggling)
  }
}
