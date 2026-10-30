import { lazy, Suspense } from 'react'
import { t } from '@shared/i18n'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import type { EditorTab } from '@/stores/editor'
import { CannotShow, Spinner } from './common'

// Loaded on first use: pdf.js, mammoth and SheetJS are large and most sessions never need them.
const MarkdownView = lazy(() => import('./MarkdownView'))
const ImageView = lazy(() => import('./ImageView'))
const SvgView = lazy(() => import('./ImageView').then((m) => ({ default: m.SvgView })))
const PdfView = lazy(() => import('./PdfView'))
const MediaView = lazy(() => import('./MediaView'))
const TableView = lazy(() => import('./TableView'))
const JsonView = lazy(() => import('./JsonView'))
const DocxView = lazy(() => import('./DocxView'))
const SheetView = lazy(() => import('./SheetView'))

function Viewer({ tab }: { tab: EditorTab }) {
  switch (tab.viewer) {
    case 'markdown':
      return <MarkdownView tab={tab} />
    case 'image':
      return <ImageView tab={tab} />
    case 'svg':
      return <SvgView tab={tab} />
    case 'pdf':
      return <PdfView tab={tab} />
    case 'audio':
    case 'video':
      return <MediaView tab={tab} />
    case 'table':
      return <TableView tab={tab} />
    case 'json':
      return <JsonView tab={tab} />
    case 'docx':
      return <DocxView tab={tab} />
    case 'sheet':
      return <SheetView tab={tab} />
    case 'text':
      return <CannotShow path={tab.path} />
  }
}

/** The viewer of a tab that is not shown in the code editor (see lib/viewers.ts). */
export function FileView({ tab }: { tab: EditorTab }) {
  return (
    <ErrorBoundary scope={t('The file viewer')}>
      <Suspense fallback={<Spinner />}>
        <Viewer tab={tab} />
      </Suspense>
    </ErrorBoundary>
  )
}
