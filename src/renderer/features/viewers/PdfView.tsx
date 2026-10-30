import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Minus, MoveHorizontal, Plus, Search } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { t, tn } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { fileUrl } from '@/lib/viewers'
import type { EditorTab } from '@/stores/editor'
import { CannotShow, Spinner } from './common'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const GAP = 12
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/** Marks the matches of `query` in the rendered text layers (CSS Custom Highlight API). */
function highlight(root: HTMLElement | null, query: string, currentPage: number | null): void {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
  if (!registry || typeof Highlight === 'undefined') return
  const all: Range[] = []
  const current: Range[] = []
  const q = query.trim().toLowerCase()
  if (root && q) {
    for (const layer of root.querySelectorAll<HTMLElement>('.textLayer')) {
      const page = Number(layer.dataset['page'])
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.toLowerCase() ?? ''
        for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) {
          const range = new Range()
          range.setStart(node, i)
          range.setEnd(node, i + q.length)
          ;(page === currentPage ? current : all).push(range)
        }
      }
    }
  }
  registry.set('pdf-search', new Highlight(...all))
  registry.set('pdf-current', new Highlight(...current))
}

function Page({
  doc,
  number,
  scale,
  estimate,
  onRendered
}: {
  doc: PDFDocumentProxy
  number: number
  scale: number
  estimate: { width: number; height: number }
  onRendered: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setVisible(true), { rootMargin: '800px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    const el = box.current
    if (!el) return
    let cancelled = false
    let task: { cancel(): void } | null = null
    let layer: { cancel(): void } | null = null
    void doc.getPage(number).then(async (page) => {
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      setSize({ width: viewport.width, height: viewport.height })
      const dpr = window.devicePixelRatio || 1
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      canvas.className = 'block'
      const render = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      task = render
      try {
        await render.promise
      } catch {
        return
      }
      if (cancelled) return
      const text = document.createElement('div')
      text.className = 'textLayer'
      text.dataset['page'] = String(number)
      el.replaceChildren(canvas, text)
      const textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport })
      layer = textLayer
      await textLayer.render().catch(() => undefined)
      if (!cancelled) onRendered()
    })
    return () => {
      cancelled = true
      task?.cancel()
      layer?.cancel()
    }
  }, [visible, doc, number, scale, onRendered])

  const shown = size ?? { width: estimate.width * scale, height: estimate.height * scale }
  return (
    <div
      ref={box}
      data-page={number}
      className="pdf-page relative mx-auto overflow-hidden bg-white shadow-md"
      style={{ width: shown.width, height: shown.height, ['--scale-factor' as string]: scale, ['--total-scale-factor' as string]: scale, ['--user-unit' as string]: 1 }}
    />
  )
}

/** Text of each page, joined, for search. */
async function pageTexts(doc: PDFDocumentProxy): Promise<string[]> {
  const out: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    out.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').toLowerCase())
  }
  return out
}

/** PDF pages drawn by pdf.js, with zoom, search and text that can be selected and copied. */
export default function PdfView({ tab }: { tab: EditorTab }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState({ width: 612, height: 792 })
  const [scale, setScale] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [texts, setTexts] = useState<string[] | null>(null)
  const [hit, setHit] = useState(0)
  const [renderTick, setRenderTick] = useState(0)

  useEffect(() => {
    let alive = true
    const loading = pdfjs.getDocument({ url: fileUrl(tab.path, tab.mtimeMs) })
    loading.promise.then(
      async (d) => {
        const first = await d.getPage(1)
        const vp = first.getViewport({ scale: 1 })
        if (!alive) return
        setEstimate({ width: vp.width, height: vp.height })
        // A new version of the file: its text is searched again.
        setTexts(null)
        setError(null)
        setDoc(d)
      },
      (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err))
    )
    return () => {
      alive = false
      void loading.destroy()
    }
  }, [tab.path, tab.mtimeMs])

  const fitWidth = useCallback(() => {
    const width = scroller.current?.clientWidth ?? 800
    setScale(clampScale((width - 48) / estimate.width))
  }, [estimate.width])

  // Fitted to the width when the document opens.
  useLayoutEffect(() => {
    if (doc && scale === null) fitWidth()
  }, [doc, scale, fitWidth])

  const matches = texts && query.trim() ? texts.map((text) => text.split(query.trim().toLowerCase()).length - 1) : null
  const pagesWithHits = matches ? matches.flatMap((n, i) => (n > 0 ? [i + 1] : [])) : []
  const total = matches?.reduce((a, b) => a + b, 0) ?? 0
  const currentPage = pagesWithHits.length ? (pagesWithHits[hit % pagesWithHits.length] ?? null) : null

  const onRendered = useCallback(() => setRenderTick((n) => n + 1), [])
  useEffect(() => highlight(scroller.current, query, currentPage), [query, currentPage, renderTick])
  useEffect(() => () => highlight(null, '', null), [])

  const goTo = (index: number) => {
    if (!pagesWithHits.length) return
    const next = (index + pagesWithHits.length) % pagesWithHits.length
    setHit(next)
    scroller.current?.querySelector(`[data-page="${pagesWithHits[next]}"]`)?.scrollIntoView({ block: 'start' })
  }

  if (error) return <CannotShow path={tab.path} title={t('This PDF cannot be shown')} description={error} />
  if (!doc || scale === null) {
    return (
      <div ref={scroller} className="h-full">
        <Spinner />
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col bg-muted/40" data-testid="pdf-view">
      <div className="flex shrink-0 items-center gap-1 border-b bg-chrome px-2 py-1 text-xs">
        <Button size="icon-xs" variant="ghost" aria-label={t('Zoom out')} onClick={() => setScale((s) => clampScale((s ?? 1) / 1.2))}>
          <Minus />
        </Button>
        <span className="w-10 text-center tabular-nums">{Math.round(scale * 100)} %</span>
        <Button size="icon-xs" variant="ghost" aria-label={t('Zoom in')} onClick={() => setScale((s) => clampScale((s ?? 1) * 1.2))}>
          <Plus />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label={t('Fit to width')} title={t('Fit to width')} onClick={fitWidth}>
          <MoveHorizontal />
        </Button>
        <span className="text-muted-foreground">· {tn('{count} page', '{count} pages', doc.numPages)}</span>
        <form
          className="ml-auto flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (!texts) void pageTexts(doc).then(setTexts)
            else goTo(hit + 1)
          }}
        >
          <span className="flex items-center gap-1 rounded-md border bg-background px-1.5">
            <Search className="size-3 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHit(0)
                if (!texts && e.target.value.trim()) void pageTexts(doc).then(setTexts)
              }}
              placeholder={t('Search in the PDF')}
              aria-label={t('Search in the PDF')}
              className="h-6 w-40 bg-transparent text-xs outline-none"
            />
          </span>
          {query.trim() && texts && <span className="text-muted-foreground tabular-nums">{tn('{count} match', '{count} matches', total)}</span>}
          <Button type="button" size="icon-xs" variant="ghost" aria-label={t('Previous match')} disabled={!pagesWithHits.length} onClick={() => goTo(hit - 1)}>
            <ChevronUp />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" aria-label={t('Next match')} disabled={!pagesWithHits.length} onClick={() => goTo(hit + 1)}>
            <ChevronDown />
          </Button>
        </form>
      </div>
      <div ref={scroller} className="selectable min-h-0 flex-1 overflow-auto py-4" style={{ display: 'grid', gap: GAP, alignContent: 'start' }}>
        {Array.from({ length: doc.numPages }, (_, i) => (
          <Page key={`${i + 1}@${scale}`} doc={doc} number={i + 1} scale={scale} estimate={estimate} onRendered={onRendered} />
        ))}
      </div>
    </div>
  )
}
