import { useEffect, useRef } from 'react'
import type { TaskFileDiff } from '@shared/tasks'
import { monaco } from '@/lib/monaco/setup'
import { languageFor } from '@/lib/monaco/models'
import { useResolvedTheme } from '@/lib/theme'
import { useSettings } from '@/stores/settings'

/** Side-by-side diff of one file, base on the left, the agent's version on the right. Read-only. */
export function DiffView({ diff }: { diff: TaskFileDiff }) {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const theme = useResolvedTheme((s) => s.theme)
  const fontSize = useSettings((s) => s.settings.editor.fontSize)

  useEffect(() => {
    if (!container.current) return
    const instance = monaco.editor.createDiffEditor(container.current, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: "'JetBrains Mono Variable', 'Cascadia Mono', monospace",
      fontSize
    })
    editor.current = instance
    return () => {
      const model = instance.getModel()
      instance.dispose()
      model?.original.dispose()
      model?.modified.dispose()
      editor.current = null
    }
    // Font size changes are applied below without recreating the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    editor.current?.updateOptions({ fontSize })
  }, [fontSize])

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'clyde-dark' : 'clyde-light')
  }, [theme])

  useEffect(() => {
    const instance = editor.current
    if (!instance) return
    const language = languageFor(diff.path)
    const previous = instance.getModel()
    instance.setModel({
      original: monaco.editor.createModel(diff.original, language),
      modified: monaco.editor.createModel(diff.modified, language)
    })
    previous?.original.dispose()
    previous?.modified.dispose()
  }, [diff])

  return <div ref={container} className="h-full w-full" data-diff={diff.path} />
}
