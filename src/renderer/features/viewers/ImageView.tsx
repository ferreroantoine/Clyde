import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { t } from '@shared/i18n'
import { CLICK_ZOOM, FIT, fitSize, panBy, zoomAt, type Size, type View } from '@/lib/image-zoom'
import { fileUrl, formatBytes } from '@/lib/viewers'
import { cn } from '@/lib/utils'
import type { EditorTab } from '@/stores/editor'
import { CannotShow, useModelText } from './common'

const MARGIN = 16
const DRAG_PX = 4

function useSize(ref: React.RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** An image fitted to the tab: click to zoom where it lands, wheel to zoom, drag to move. */
function ZoomPane({ src, size, onError }: { src: string; size: number | undefined; onError?: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const area = useSize(box)
  const [natural, setNatural] = useState<Size | null>(null)
  const [view, setView] = useState<View>(FIT)
  const [animate, setAnimate] = useState(false)
  const [dragging, setDragging] = useState(false)
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const fitted = natural && area ? fitSize(natural.width && natural.height ? natural : area, area, MARGIN) : null

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = box.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={box}
        className="relative min-h-0 flex-1 overflow-hidden"
        onWheel={(e) => {
          if (!fitted || !area) return
          setAnimate(false)
          setView((v) => zoomAt(v, v.scale * Math.exp(-e.deltaY * 0.0015), local(e), fitted, area))
        }}
      >
        <div className="absolute inset-0 grid place-items-center">
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            onError={onError}
            onPointerDown={(e: ReactPointerEvent<HTMLImageElement>) => {
              if (e.button !== 0) return
              e.currentTarget.setPointerCapture(e.pointerId)
              press.current = { x: e.clientX, y: e.clientY, moved: false }
            }}
            onPointerMove={(e) => {
              const p = press.current
              if (!p || !fitted || !area || view.scale === 1) return
              if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_PX) return
              if (!p.moved) setDragging(true)
              p.moved = true
              setAnimate(false)
              setView((v) => panBy(v, e.clientX - p.x, e.clientY - p.y, fitted, area))
              p.x = e.clientX
              p.y = e.clientY
            }}
            onPointerUp={(e) => {
              const p = press.current
              press.current = null
              setDragging(false)
              if (!p || p.moved || !fitted || !area) return
              setAnimate(true)
              setView((v) => (v.scale === 1 ? zoomAt(v, CLICK_ZOOM, local(e), fitted, area) : FIT))
            }}
            style={{ width: fitted?.width, height: fitted?.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            className={cn(
              'checkerboard max-w-none select-none',
              !fitted && 'invisible',
              animate && 'transition-transform duration-200 ease-out',
              view.scale === 1 ? 'cursor-zoom-in' : dragging ? 'cursor-grabbing' : 'cursor-grab'
            )}
          />
        </div>
      </div>
      <p className="flex shrink-0 justify-center gap-3 border-t px-3 py-1 text-[11px] text-muted-foreground tabular-nums">
        {natural && natural.width > 0 && <span>{t('{width} × {height} px', { width: natural.width, height: natural.height })}</span>}
        {size !== undefined && <span>{formatBytes(size)}</span>}
        {view.scale !== 1 && <span>{Math.round(view.scale * 100)} %</span>}
      </p>
    </div>
  )
}

export default function ImageView({ tab }: { tab: EditorTab }) {
  const [brokenFor, setBrokenFor] = useState<string | null>(null)
  const src = fileUrl(tab.path, tab.mtimeMs)
  if (brokenFor === src) return <CannotShow path={tab.path} title={t('This image cannot be shown')} description={t('The file may be damaged, or in a format Chromium does not read.')} />
  return (
    <div className="h-full bg-editor" data-testid="image-view">
      {/* A new version of the file starts fitted again. */}
      <ZoomPane key={src} src={src} size={tab.size} onError={() => setBrokenFor(src)} />
    </div>
  )
}

/** An SVG drawn from the editor's text, so the preview follows the edits. */
export function SvgView({ tab }: { tab: EditorTab }) {
  const text = useModelText(tab.path)
  // An <img> runs no script in the SVG.
  const url = useMemo(() => URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })), [text])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <div className="h-full bg-editor" data-testid="image-view">
      <ZoomPane src={url} size={tab.size} />
    </div>
  )
}
