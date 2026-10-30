import { useMemo } from 'react'
import { TriangleAlert } from 'lucide-react'
import { t, tn } from '@shared/i18n'
import { guessDelimiter, parseDelimited } from '@/lib/delimited'
import { extensionOf } from '@/lib/viewers'
import type { EditorTab } from '@/stores/editor'
import { CannotShow, Spinner, useFileBytes, useModelText } from './common'
import { DataGrid } from './DataGrid'

const MAX_ROWS = 100_000
/** A table too large for the editor: its start, read as a range. */
const HEAD_BYTES = 4 * 1024 * 1024

function Grid({ tab, text, partial }: { tab: EditorTab; text: string; partial: boolean }) {
  const table = useMemo(() => {
    // A cut file ends mid-row: drop that last line.
    const body = partial ? text.slice(0, Math.max(0, text.lastIndexOf('\n'))) : text
    return parseDelimited(body, guessDelimiter(body, extensionOf(tab.path)), MAX_ROWS)
  }, [text, partial, tab.path])
  const cut = partial || table.truncated
  return (
    <DataGrid
      header={table.header}
      rows={table.rows}
      footer={
        <span className="flex items-center gap-1.5">
          {cut && <TriangleAlert className="size-3.5 text-warning" />}
          {tn('{count} row', '{count} rows', table.rows.length)} · {tn('{count} column', '{count} columns', table.header.length)}
          {cut && ` · ${t('Only the first rows are shown: the file is larger.')}`}
        </span>
      }
    />
  )
}

function FromEditor({ tab }: { tab: EditorTab }) {
  const text = useModelText(tab.path)
  return <Grid tab={tab} text={text} partial={false} />
}

function FromDisk({ tab }: { tab: EditorTab }) {
  const bytes = useFileBytes(tab, HEAD_BYTES)
  const text = useMemo(() => (bytes.state === 'ready' ? new TextDecoder().decode(bytes.value) : ''), [bytes])
  if (bytes.state === 'loading') return <Spinner />
  if (bytes.state === 'error') return <CannotShow path={tab.path} description={bytes.message} />
  return <Grid tab={tab} text={text} partial />
}

/** CSV and TSV as a table; from the editor's text, or from the file's start when it is too large to edit. */
export default function TableView({ tab }: { tab: EditorTab }) {
  return <div className="h-full bg-editor" data-testid="table-view">{tab.hasText ? <FromEditor tab={tab} /> : <FromDisk tab={tab} />}</div>
}
