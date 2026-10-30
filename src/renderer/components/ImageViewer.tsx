import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { t } from '@shared/i18n'
import { CLICK_ZOOM, FIT, fitSize, panBy, zoomAt, type Size, type View } from '@/lib/image-zoom'
import { cn } from '@/lib/utils'

const MARGIN = 24
/** A press that moves less than this is a click, not a drag. */
const DRAG_PX = 4

function useViewport(): Size {
  const [size, setSize] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

function ZoomableImage({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const viewport = useViewport()
  const [natural, setNatural] = useState<Size | null>(null)
  const [view, setView] = useState<View>(FIT)
  const [animate, setAnimate] = useState(false)
  const [dragging, setDragging] = useState(false)
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  // An SVG without width and height reports 0: give it most of the screen.
  const fitted = natural ? fitSize(natural.width && natural.height ? natural : { width: viewport.width, height: viewport.height }, viewport, MARGIN) : null

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    const p = press.current
    if (!p || !fitted || view.scale === 1) return
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_PX) return
    if (!p.moved) setDragging(true)
    p.moved = true
    setAnimate(false)
    setView((v) => panBy(v, e.clientX - p.x, e.clientY - p.y, fitted, viewport))
    p.x = e.clientX
    p.y = e.clientY
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLImageElement>) => {
    const p = press.current
    press.current = null
    setDragging(false)
    if (!p || p.moved || !fitted) return
    setAnimate(true)
    setView((v) => (v.scale === 1 ? zoomAt(v, CLICK_ZOOM, { x: e.clientX, y: e.clientY }, fitted, viewport) : FIT))
  }
  const onWheel = (e: ReactWheelEvent) => {
    if (!fitted) return
    setAnimate(false)
    setView((v) => zoomAt(v, v.scale * Math.exp(-e.deltaY * 0.0015), { x: e.clientX, y: e.clientY }, fitted, viewport))
  }

  return (
    <div
      className="fixed inset-0 grid place-items-center"
      onWheel={onWheel}
      // Only the backdrop closes; a click on the image zooms.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          press.current = null
          setDragging(false)
        }}
        style={{
          width: fitted?.width,
          height: fitted?.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
        }}
        className={cn(
          'max-w-none select-none',
          !fitted && 'invisible',
          animate && 'transition-transform duration-200 ease-out',
          view.scale === 1 ? 'cursor-zoom-in' : dragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
      />
    </div>
  )
}

/**
 * An image full screen over a dark backdrop, with nothing around it. A click on the image
 * zooms in where it lands, a second click fits it again; the wheel zooms, a drag moves the
 * zoomed image. A click beside the image, or Escape, closes.
 */
export function ImageViewer({ src, alt = '', onClose }: { src: string | null; alt?: string; onClose: () => void }) {
  // The last image stays on screen while the viewer fades out.
  const [shown, setShown] = useState(src)
  if (src && src !== shown) setShown(src)
  return (
    <DialogPrimitive.Root open={!!src} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 overflow-hidden outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          data-testid="image-viewer"
        >
          <DialogPrimitive.Title className="sr-only">{alt || t('Image')}</DialogPrimitive.Title>
          {shown && <ZoomableImage key={shown} src={shown} alt={alt} onClose={onClose} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
