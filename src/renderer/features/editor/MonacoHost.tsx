import { useEffect, useRef } from 'react'
import { monaco } from '@/lib/monaco/setup'
import { getModel } from '@/lib/monaco/models'
import { saveHooks, useEditor } from '@/stores/editor'
import { useSettings } from '@/stores/settings'
import { useResolvedTheme } from '@/lib/theme'

const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

/** A single Monaco instance whose model is swapped as the active tab changes. */
export function MonacoHost({ path, ready }: { path: string | null; ready: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const currentPath = useRef<string | null>(null)
  const theme = useResolvedTheme((s) => s.theme)
  const options = useSettings((s) => s.settings.editor)
  const reveal = useEditor((s) => s.reveal)

  useEffect(() => {
    if (!container.current) return
    const editor = monaco.editor.create(container.current, {
      model: null,
      automaticLayout: true,
      fontFamily: useSettings.getState().settings.editor.fontFamily,
      fontLigatures: true,
      fontSize: useSettings.getState().settings.editor.fontSize,
      wordWrap: useSettings.getState().settings.editor.wordWrap ? 'on' : 'off',
      lineHeight: 1.6,
      minimap: { enabled: useSettings.getState().settings.editor.minimap, renderCharacters: false, scale: 1 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'all',
      padding: { top: 10 },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: 'active', indentation: true },
      stickyScroll: { enabled: true },
      tabSize: useSettings.getState().settings.editor.tabSize
    })
    // Format on save (Settings › Editor), with the formatter Monaco has for the language.
    saveHooks.beforeSave = async () => {
      if (!useSettings.getState().settings.editor.formatOnSave) return
      await editor.getAction('editor.action.formatDocument')?.run()
    }
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void useEditor.getState().save())
    const cursorSub = editor.onDidChangeCursorPosition((e) =>
      useEditor.getState().setCursor({ line: e.position.lineNumber, column: e.position.column })
    )
    editorRef.current = editor
    return () => {
      saveHooks.beforeSave = null
      cursorSub.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'atelier-dark' : 'atelier-light')
  }, [theme])

  useEffect(() => {
    const editor = editorRef.current
    editor?.updateOptions({
      fontSize: options.fontSize,
      fontFamily: options.fontFamily,
      wordWrap: options.wordWrap ? 'on' : 'off',
      minimap: { enabled: options.minimap, renderCharacters: false, scale: 1 }
    })
    editor?.getModel()?.updateOptions({ tabSize: options.tabSize })
  }, [options])

  // Swap models, remembering scroll and cursor per file.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (currentPath.current && getModel(currentPath.current)) {
      viewStates.set(currentPath.current, editor.saveViewState())
    }
    const model = path && ready ? getModel(path) : null
    editor.setModel(model)
    model?.updateOptions({ tabSize: useSettings.getState().settings.editor.tabSize })
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
