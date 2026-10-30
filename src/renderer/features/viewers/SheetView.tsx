import { useEffect, useMemo, useState } from 'react'
import { t, tn } from '@shared/i18n'
import { cn } from '@/lib/utils'
import type { EditorTab } from '@/stores/editor'
import { CannotShow, Spinner, useFileBytes } from './common'
import { DataGrid } from './DataGrid'

interface Sheet {
  name: string
  rows: string[][]
}

/** Every sheet as rows of displayed text (formatted numbers and dates, as the spreadsheet shows them). */
async function readSheets(data: ArrayBuffer): Promise<Sheet[]> {
  const XLSX = await import('xlsx')
  const book = XLSX.read(data, { type: 'array', cellDates: true, dense: true })
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name]
    const rows = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false }) : []
    return { name, rows: rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))) }
  })
}

/** Column letters, as the spreadsheet names them: A … Z, AA … */
function letters(n: number): string {
  let s = ''
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

/** Excel and OpenDocument spreadsheets, read only, one tab per sheet. */
export default function SheetView({ tab }: { tab: EditorTab }) {
  const bytes = useFileBytes(tab)
  const [book, setBook] = useState<{ for: ArrayBuffer; sheets: Sheet[] } | { for: ArrayBuffer; error: string } | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (bytes.state !== 'ready') return
    let alive = true
    const source = bytes.value
    readSheets(source).then(
      (sheets) => alive && setBook({ for: source, sheets }),
      (err: unknown) => alive && setBook({ for: source, error: err instanceof Error ? err.message : String(err) })
    )
    return () => {
      alive = false
    }
  }, [bytes])

  const current = bytes.state === 'ready' && book?.for === bytes.value ? book : null
  const sheet = current && 'sheets' in current ? (current.sheets[index] ?? current.sheets[0]) : undefined
  const header = useMemo(() => {
    const width = Math.max(0, ...(sheet?.rows.slice(0, 1000).map((r) => r.length) ?? [0]))
    return Array.from({ length: width }, (_, i) => letters(i))
  }, [sheet])

  if (bytes.state === 'error') return <CannotShow path={tab.path} description={bytes.message} />
  if (!current) return <Spinner />
  if ('error' in current) return <CannotShow path={tab.path} title={t('This spreadsheet cannot be shown')} description={current.error} />
  return (
    <div className="flex h-full flex-col bg-editor" data-testid="sheet-view">
      <div className="min-h-0 flex-1">
        {sheet && sheet.rows.length > 0 ? (
          <DataGrid header={header} rows={sheet.rows} footer={tn('{count} row', '{count} rows', sheet.rows.length)} />
        ) : (
          <p className="p-6 text-center text-xs text-muted-foreground">{t('This sheet is empty.')}</p>
        )}
      </div>
      {current.sheets.length > 1 && (
        <div className="flex shrink-0 gap-px overflow-x-auto border-t bg-chrome text-xs" role="tablist" aria-label={t('Sheets')}>
          {current.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => setIndex(i)}
              className={cn('press shrink-0 px-3 py-1.5', i === index ? 'bg-editor font-medium text-foreground' : 'text-muted-foreground hover:bg-accent')}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
