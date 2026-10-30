import { useMemo } from 'react'
import { Markdown, type MarkdownFileOptions } from '@/features/chat/Markdown'
import { fileUrl, resolveRelative } from '@/lib/viewers'
import { useEditor, type EditorTab } from '@/stores/editor'
import { useModelText } from './common'

/** A Markdown file as it reads: GFM, math, colored code, its images and links to other files. */
export default function MarkdownView({ tab }: { tab: EditorTab }) {
  const text = useModelText(tab.path)
  const options = useMemo<MarkdownFileOptions>(
    () => ({
      imageUrl: (src) => {
        if (/^data:image\//i.test(src)) return src
        const rel = resolveRelative(tab.path, src)
        return rel ? fileUrl(rel) : null
      },
      openLink: (href) => {
        const rel = resolveRelative(tab.path, href)
        if (!rel) return false
        void useEditor.getState().open(rel)
        return true
      }
    }),
    [tab.path]
  )
  return (
    <div className="selectable h-full overflow-y-auto bg-editor" data-testid="markdown-view">
      <div className="mx-auto max-w-3xl px-8 py-6">
        <Markdown text={text} file={options} />
      </div>
    </div>
  )
}
