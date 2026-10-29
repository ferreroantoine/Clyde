import { monaco } from './setup'

let languageIndex: { byExt: Map<string, string>; byName: Map<string, string> } | null = null

function index() {
  if (languageIndex) return languageIndex
  const byExt = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const lang of monaco.languages.getLanguages()) {
    for (const ext of lang.extensions ?? []) if (!byExt.has(ext.toLowerCase())) byExt.set(ext.toLowerCase(), lang.id)
    for (const name of lang.filenames ?? []) byName.set(name.toLowerCase(), lang.id)
  }
  languageIndex = { byExt, byName }
  return languageIndex
}

export function languageFor(path: string): string {
  const name = (path.split('/').pop() ?? path).toLowerCase()
  const { byExt, byName } = index()
  const exact = byName.get(name)
  if (exact) return exact
  const dot = name.lastIndexOf('.')
  return (dot >= 0 && byExt.get(name.slice(dot))) || 'plaintext'
}

export function uriFor(path: string): monaco.Uri {
  return monaco.Uri.from({ scheme: 'file', path: '/' + path })
}

export function getModel(path: string): monaco.editor.ITextModel | null {
  return monaco.editor.getModel(uriFor(path))
}

/** Creates the model or replaces its content, keeping undo history when it already exists. */
export function upsertModel(path: string, content: string): monaco.editor.ITextModel {
  const existing = getModel(path)
  if (existing) {
    if (existing.getValue() !== content) {
      existing.pushEditOperations([], [{ range: existing.getFullModelRange(), text: content }], () => null)
    }
    return existing
  }
  return monaco.editor.createModel(content, languageFor(path), uriFor(path))
}

export function disposeModel(path: string): void {
  getModel(path)?.dispose()
}
