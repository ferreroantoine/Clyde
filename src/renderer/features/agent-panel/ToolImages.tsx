import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { t } from '@shared/i18n'
import type { ToolImage } from '@shared/agent'
import { ImageViewer } from '@/components/ImageViewer'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'

/** Loaded images by session and id; a screenshot is read from main once. */
const cache = new Map<string, Promise<string>>()

function load(sessionId: string, id: string): Promise<string> {
  const key = `${sessionId}/${id}`
  let src = cache.get(key)
  if (!src) {
    src = invoke('agent:media', { sessionId, id }).then(({ mime, data }) => `data:${mime};base64,${data}`)
    // A failure is not cached: the next render may try again.
    src.catch(() => cache.delete(key))
    cache.set(key, src)
  }
  return src
}

function useImage(sessionId: string, id: string | undefined): string | null | 'error' {
  const [src, setSrc] = useState<string | null | 'error'>(null)
  useEffect(() => {
    if (!id) return
    let alive = true
    load(sessionId, id).then(
      (value) => alive && setSrc(value),
      () => alive && setSrc('error')
    )
    return () => {
      alive = false
    }
  }, [sessionId, id])
  return src
}

function Thumb({ sessionId, image, onOpen }: { sessionId: string; image: ToolImage; onOpen: (src: string) => void }) {
  const src = useImage(sessionId, image.id)
  if (src === 'error') {
    return (
      <span className="grid h-20 w-28 place-items-center rounded border bg-muted text-muted-foreground" title={t('This image is no longer available')}>
        <ImageOff className="size-4" />
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => src && onOpen(src)}
      className={cn('press overflow-hidden rounded border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring', !src && 'h-20 w-28 animate-pulse')}
      aria-label={t('Open the image')}
    >
      {src && <img src={src} alt="" className="max-h-40 max-w-full object-contain" draggable={false} />}
    </button>
  )
}

/** Screenshots and images a tool returned, as thumbnails that open full size. */
export function ToolImages({ sessionId, images, className }: { sessionId: string; images: ToolImage[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!images.length) return null
  return (
    <>
      <div className={cn('flex flex-wrap gap-1.5', className)} data-testid="tool-images">
        {images.map((image) => (
          <Thumb key={image.id} sessionId={sessionId} image={image} onOpen={setOpen} />
        ))}
      </div>
      <ImageViewer src={open} alt={t('Image from the agent')} onClose={() => setOpen(null)} />
    </>
  )
}
