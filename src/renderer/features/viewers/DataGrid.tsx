import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { intlLocale, t } from '@shared/i18n'
import { compareCells } from '@/lib/delimited'
import { cn } from '@/lib/utils'

const ROW = 26
const OVERSCAN = 12
const INDEX_WIDTH = 56

/** Column widths from a sample of the rows: wide enough for most values, never huge. */
function widths(header: string[], rows: string[][]): number[] {
  const sample = rows.slice(0, 300)
  return header.map((h, i) => {
    const longest = Math.max(h.length, ...sample.map((r) => Math.min((r[i] ?? '').length, 60)))
    return Math.round(Math.min(360, Math.max(64, longest * 7.2 + 28)))
  })
}

/**
 * A read-only table: fixed header, only the rows on screen in the DOM, sorted by a click on a
 * column (again for the other way, a third time for the file's order).
 */
export function DataGrid({ header, rows, footer }: { header: string[]; rows: string[][]; footer?: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const [sort, setSort] = useState<{ column: number; dir: 1 | -1 } | null>(null)
  const cols = useMemo(() => widths(header, rows), [header, rows])
  const template = `${INDEX_WIDTH}px ${cols.map((w) => `${w}px`).join(' ')}`
  const total = INDEX_WIDTH + cols.reduce((a, b) => a + b, 0)

  const order = useMemo(() => {
    const indices = rows.map((_, i) => i)
    if (!sort) return indices
    const collator = new Intl.Collator(intlLocale(), { numeric: true, sensitivity: 'base' })
    return indices.sort((a, b) => sort.dir * compareCells(rows[a]?.[sort.column] ?? '', rows[b]?.[sort.column] ?? '', collator))
  }, [rows, sort])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setHeight(entry.contentRect.height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const last = Math.min(order.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN)
  const cycle = (column: number) =>
    setSort((s) => (s?.column !== column ? { column, dir: 1 } : s.dir === 1 ? { column, dir: -1 } : null))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="selectable min-h-0 flex-1 overflow-auto font-mono text-[12px]" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="table" aria-rowcount={rows.length + 1}>
        <div className="relative" style={{ width: total, height: (order.length + 1) * ROW }}>
          <div className="sticky top-0 z-10 grid border-b bg-chrome font-sans text-[12px] font-medium" style={{ gridTemplateColumns: template, height: ROW }} role="row">
            <span className="sticky left-0 border-r bg-chrome" />
            {header.map((name, i) => (
              <button
                key={i}
                type="button"
                role="columnheader"
                aria-sort={sort?.column === i ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                title={t('Sort by {column}', { column: name || String(i + 1) })}
                onClick={() => cycle(i)}
                className="flex min-w-0 items-center gap-1 border-r px-2 text-left hover:bg-accent"
              >
                <span className="truncate">{name || <span className="text-muted-foreground">{i + 1}</span>}</span>
                {sort?.column === i && (sort.dir === 1 ? <ArrowUp className="size-3 shrink-0" /> : <ArrowDown className="size-3 shrink-0" />)}
              </button>
            ))}
          </div>
          {order.slice(first, last).map((rowIndex, k) => {
            const row = rows[rowIndex] ?? []
            const at = first + k
            return (
              <div
                key={rowIndex}
                role="row"
                className={cn('absolute left-0 grid border-b border-border/50', at % 2 === 1 && 'bg-muted/30')}
                style={{ top: (at + 1) * ROW, height: ROW, gridTemplateColumns: template, width: total }}
              >
                <span className="sticky left-0 border-r bg-chrome px-2 text-right leading-[26px] text-muted-foreground tabular-nums">{rowIndex + 1}</span>
                {header.map((_, i) => (
                  <span key={i} role="cell" className="truncate border-r border-border/50 px-2 leading-[26px]" title={row[i]}>
                    {row[i]}
                  </span>
                ))}
              </div>
            )
          })}
        </div>
      </div>
      {footer && <div className="shrink-0 border-t px-3 py-1 text-[11px] text-muted-foreground">{footer}</div>}
    </div>
  )
}
