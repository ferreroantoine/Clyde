/**
 * Zoom and pan for an image shown fitted at the middle of a viewport. The image is drawn at
 * its fitted size with `translate(x, y) scale(scale)` around its center, so `scale` 1 is the
 * fitted view and the offset moves its center away from the viewport's.
 */
export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface View {
  scale: number
  x: number
  y: number
}

export const FIT: View = { scale: 1, x: 0, y: 0 }
export const CLICK_ZOOM = 2.5
export const MAX_ZOOM = 8

/** The size the image is drawn at for `scale` 1: whole on screen, never larger than it is. */
export function fitSize(natural: Size, viewport: Size, margin: number): Size {
  const ratio = Math.min(1, (viewport.width - 2 * margin) / natural.width, (viewport.height - 2 * margin) / natural.height)
  const r = Math.max(ratio, 0)
  return { width: natural.width * r, height: natural.height * r }
}

/** Keeps the image covering the viewport where it is larger, and centered where it is not. */
export function clampView(view: View, fitted: Size, viewport: Size): View {
  const maxX = Math.max(0, (fitted.width * view.scale - viewport.width) / 2)
  const maxY = Math.max(0, (fitted.height * view.scale - viewport.height) / 2)
  return { scale: view.scale, x: Math.min(maxX, Math.max(-maxX, view.x)), y: Math.min(maxY, Math.max(-maxY, view.y)) }
}

/**
 * Zooms to `scale`, keeping the image point under `at` (viewport coordinates) where it is.
 * Clamped, so near an edge the point moves as little as the image allows.
 */
export function zoomAt(view: View, scale: number, at: Point, fitted: Size, viewport: Size): View {
  const s = Math.min(MAX_ZOOM, Math.max(1, scale))
  // From the viewport's center to the cursor, then into the image's own (unscaled) units.
  const px = at.x - viewport.width / 2
  const py = at.y - viewport.height / 2
  const qx = (px - view.x) / view.scale
  const qy = (py - view.y) / view.scale
  return clampView({ scale: s, x: px - s * qx, y: py - s * qy }, fitted, viewport)
}

/** Moves a zoomed image by a drag of `dx`, `dy` pixels. */
export function panBy(view: View, dx: number, dy: number, fitted: Size, viewport: Size): View {
  return clampView({ scale: view.scale, x: view.x + dx, y: view.y + dy }, fitted, viewport)
}
