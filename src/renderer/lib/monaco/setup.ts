import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  }
}

// Files are opened one by one without a project model, so semantic errors
// (unresolved imports, missing types) would be noise. Keep syntax checks only.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
  defaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    jsx: monaco.typescript.JsxEmit.Preserve
  })
}

monaco.editor.defineTheme('atelier-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editor.lineHighlightBackground': '#f5f6f8',
    'editorLineNumber.foreground': '#a7abb5',
    'editorLineNumber.activeForeground': '#4a4f5c',
    'editorIndentGuide.background1': '#eceef2',
    'editor.selectionBackground': '#d9defa',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#e3e5ea'
  }
})

monaco.editor.defineTheme('atelier-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#15161a',
    'editor.lineHighlightBackground': '#1c1d22',
    'editorLineNumber.foreground': '#555a66',
    'editorLineNumber.activeForeground': '#b4b8c2',
    'editorIndentGuide.background1': '#23252b',
    'editor.selectionBackground': '#34396a',
    'editorWidget.background': '#1b1c21',
    'editorWidget.border': '#2a2c33'
  }
})

export { monaco }
