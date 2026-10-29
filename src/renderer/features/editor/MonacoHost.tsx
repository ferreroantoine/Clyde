import { useEffect, useRef } from 'react'
import { monaco } from '@/lib/monaco/setup'
import { getModel } from '@/lib/monaco/models'
import { useEditor } from '@/stores/editor'
import { useSettings } from '@/stores/settings'
import { useResolvedTheme } from '@/lib/theme'

const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

/** A single Monaco instance whose model is swapped as the active tab changes. */
export function MonacoHost({ path, ready }: { path: string | null; ready: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const currentPath = useRef<string | null>(null)
  const theme = useResolvedTheme((s) => s.theme)
  const fontSize = useSettings((s) => s.settings.editorFontSize)
  const reveal = useEditor((s) => s.reveal)

  useEffect(() => {
    if (!container.current) return
    const editor = monaco.editor.create(container.current, {
      model: null,
      automaticLayout: true,
      fontFamily: "'JetBrains Mono Variable', 'Cascadia Code', monospace",
      fontLigatures: true,
      fontSize: useSettings.getState().settings.editorFontSize,
      lineHeight: 1.6,
      minimap: { enabled: true, renderCharacters: false, scale: 1 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'all',
      padding: { top: 10 },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: 'active', indentation: true },
      stickyScroll: { enabled: true },
      tabSize: 2
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void useEditor.getState().save())
    const cursorSub = editor.onDidChangeCursorPosition((e) =>
      useEditor.getState().setCursor({ line: e.position.lineNumber, column: e.position.column })
    )
    editorRef.current = editor
    return () => {
      cursorSub.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'clyde-dark' : 'clyde-light')
  }, [theme])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize })
  }, [fontSize])

  // Swap models, remembering scroll and cursor per file.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (currentPath.current && getModel(currentPath.current)) {
      viewStates.set(currentPath.current, editor.saveViewState())
    }
    const model = path && ready ? getModel(path) : null
    editor.setModel(model)
    currentPath.current = model ? path : null
    if (model && path) {
      const state = viewStates.get(path)
      if (state) editor.restoreViewState(state)
      editor.focus()
      const pos = editor.getPosition()
      if (pos) useEditor.getState().setCursor({ line: pos.lineNumber, column: pos.column })
    }
  }, [path, ready])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !reveal || reveal.path !== path || !ready) return
    const range = new monaco.Range(reveal.line, reveal.column, reveal.line, reveal.column + (reveal.length ?? 0))
    editor.setSelection(range)
    editor.revealRangeInCenterIfOutsideViewport(range)
    editor.focus()
    useEditor.getState().consumeReveal()
  }, [reveal, path, ready])

  return <div ref={container} className="h-full w-full" />
}
