import { describe, expect, it } from 'vitest'
import { CLICK_ZOOM, FIT, MAX_ZOOM, clampView, fitSize, panBy, zoomAt } from './image-zoom'

const viewport = { width: 1000, height: 800 }

describe('fitSize', () => {
  it('shrinks a large image to the viewport, margins kept', () => {
    expect(fitSize({ width: 4000, height: 2000 }, viewport, 20)).toEqual({ width: 960, height: 480 })
  })

  it('never enlarges a small image', () => {
    expect(fitSize({ width: 200, height: 100 }, viewport, 20)).toEqual({ width: 200, height: 100 })
  })
})

describe('zoomAt', () => {
  const fitted = { width: 960, height: 760 }

  it('keeps the clicked point under the cursor', () => {
    const at = { x: 700, y: 300 }
    const view = zoomAt(FIT, CLICK_ZOOM, at, fitted, viewport)
    expect(view.scale).toBe(CLICK_ZOOM)
    // The image point that was under the cursor (200, -100 from the center) is still there.
    expect(view.x + view.scale * 200).toBeCloseTo(200)
    expect(view.y + view.scale * -100).toBeCloseTo(-100)
  })

  it('zooming on the center keeps the image centered', () => {
    expect(zoomAt(FIT, CLICK_ZOOM, { x: 500, y: 400 }, fitted, viewport)).toEqual({ scale: CLICK_ZOOM, x: 0, y: 0 })
  })

  it('does not let a corner click pull the image off screen', () => {
    const view = zoomAt(FIT, CLICK_ZOOM, { x: 0, y: 0 }, fitted, viewport)
    expect(view.x).toBe((960 * CLICK_ZOOM - 1000) / 2)
    expect(view.y).toBe((760 * CLICK_ZOOM - 800) / 2)
  })

  it('stays between the fitted view and the maximum', () => {
    expect(zoomAt(FIT, 0.2, { x: 10, y: 10 }, fitted, viewport)).toEqual(FIT)
    expect(zoomAt(FIT, 50, { x: 500, y: 400 }, fitted, viewport).scale).toBe(MAX_ZOOM)
  })
})

describe('panBy', () => {
  it('moves a zoomed image, up to its edges', () => {
    const fitted = { width: 960, height: 760 }
    const zoomed = { scale: 2, x: 0, y: 0 }
    expect(panBy(zoomed, 100, -50, fitted, viewport)).toEqual({ scale: 2, x: 100, y: -50 })
    expect(panBy(zoomed, 5000, 5000, fitted, viewport)).toEqual({ scale: 2, x: 460, y: 360 })
  })

  it('keeps a small image centered', () => {
    expect(clampView({ scale: 2, x: 80, y: 80 }, { width: 200, height: 100 }, viewport)).toEqual({ scale: 2, x: 0, y: 0 })
  })
})
