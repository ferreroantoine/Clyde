import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { t } from '@shared/i18n'
import type { EditorTab } from '@/stores/editor'
import { CannotShow, Spinner, useFileBytes } from './common'

/** A Word document as HTML (mammoth), cleaned before it is shown; read only. */
export default function DocxView({ tab }: { tab: EditorTab }) {
  const bytes = useFileBytes(tab)
  const [html, setHtml] = useState<{ for: ArrayBuffer; html: string } | { for: ArrayBuffer; error: string } | null>(null)

  useEffect(() => {
    if (bytes.state !== 'ready') return
    let alive = true
    const source = bytes.value
    void import('mammoth')
      .then(({ default: mammoth }) => mammoth.convertToHtml({ arrayBuffer: source }))
      .then(
        (result) => alive && setHtml({ for: source, html: DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } }) }),
        (err: unknown) => alive && setHtml({ for: source, error: err instanceof Error ? err.message : String(err) })
      )
    return () => {
      alive = false
    }
  }, [bytes])

  if (bytes.state === 'error') return <CannotShow path={tab.path} description={bytes.message} />
  const current = bytes.state === 'ready' && html?.for === bytes.value ? html : null
  if (!current) return <Spinner />
  if ('error' in current) return <CannotShow path={tab.path} title={t('This document cannot be shown')} description={current.error} />
  return (
    <div className="selectable h-full overflow-y-auto bg-editor" data-testid="docx-view">
      {/* Sanitized above: mammoth's HTML holds only document markup and data: images. */}
      <article className="chat-prose mx-auto max-w-3xl px-8 py-6" dangerouslySetInnerHTML={{ __html: current.html }} />
    </div>
  )
}
