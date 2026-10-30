import { t } from '@shared/i18n'
import type { DirEntry } from '@shared/types'
import { invoke } from '@/lib/ipc'
import { notify } from '@/stores/notifications'
import { parentOf, useExplorer } from '@/stores/explorer'
import { useEditor } from '@/stores/editor'
import { useWorkspace } from '@/stores/workspace'
import { useTerminals } from '@/stores/terminals'
import { useLayout } from '@/stores/layout'
import { useAgents } from '@/stores/agents'
import { useTodos } from '@/stores/todos'
import { mention } from './mention'

/** What the explorer's context menu and keyboard shortcuts do with an entry. */

const nameOf = (path: string) => path.split('/').pop() ?? path
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

/** Rejects names that would leave the folder or that Windows cannot store. */
export function invalidName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return t('A name is required')
  if (/[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') return t('This name is not allowed')
  return null
}

/** Saves what was typed in the tree's name field; empty or unchanged names just cancel. */
export async function commitTreeEdit(name: string): Promise<void> {
  const explorer = useExplorer.getState()
  const edit = explorer.editing
  explorer.setEditing(null)
  if (!edit || !name.trim()) return
  const problem = invalidName(name)
  if (problem) {
    notify.error(problem)
    return
  }
  try {
    if (edit.mode === 'rename') {
      const to = join(parentOf(edit.path), name.trim())
      if (to === edit.path) return
      const entry = await invoke('fs:rename', { from: edit.path, to })
      useEditor.getState().moved(edit.path, entry.path)
      explorer.select(entry.path)
    } else {
      const path = join(edit.parent, name.trim())
      const entry = await invoke(edit.mode === 'file' ? 'fs:createFile' : 'fs:createDir', { path })
      explorer.select(entry.path)
      if (entry.kind === 'file') void useEditor.getState().open(entry.path)
    }
    await explorer.loadDir(edit.mode === 'rename' ? parentOf(edit.path) : edit.parent)
  } catch (err) {
    notify.error(edit.mode === 'rename' ? t('Could not rename {name}', { name: nameOf(edit.path) }) : t('Could not create {name}', { name: name.trim() }), err)
  }
}

export async function duplicateEntry(entry: DirEntry): Promise<void> {
  try {
    const copy = await invoke('fs:duplicate', { path: entry.path })
    await useExplorer.getState().loadDir(parentOf(entry.path))
    useExplorer.getState().select(copy.path)
  } catch (err) {
    notify.error(t('Could not duplicate {name}', { name: entry.name }), err)
  }
}

export async function trashEntry(path: string, kind: DirEntry['kind']): Promise<void> {
  const name = nameOf(path)
  const question = kind === 'dir' ? t('Move the folder {name} and its contents to the Recycle Bin?', { name }) : t('Move {name} to the Recycle Bin?', { name })
  if (!window.confirm(question)) return
  try {
    await invoke('fs:trash', { path })
    useEditor.getState().removed(path)
    await useExplorer.getState().loadDir(parentOf(path))
  } catch (err) {
    notify.error(t('Could not delete {name}', { name }), err)
  }
}

/** The OS path of a workspace entry, with the platform's separators. */
export function absolutePath(path: string): string {
  const root = useWorkspace.getState().info?.root ?? ''
  const sep = window.clyde.platform === 'win32' ? '\\' : '/'
  return path ? root.replace(/[\\/]+$/, '') + sep + path.split('/').join(sep) : root
}

export function copyText(text: string): void {
  navigator.clipboard.writeText(text).then(
    () => notify.success(t('Copied')),
    (err) => notify.error(t('Could not copy'), err)
  )
}

export function revealInOs(path: string): void {
  invoke('fs:reveal', { path }).catch((err) => notify.error(t('Could not show {name}', { name: nameOf(path) || path }), err))
}

/** Opens a shell in the folder, or in the folder holding the file. */
export function openTerminalAt(entry: DirEntry): void {
  useLayout.getState().setTerminalOpen(true)
  void useTerminals.getState().create(absolutePath(entry.kind === 'dir' ? entry.path : parentOf(entry.path)))
}

export function addToAgent(path: string): void {
  useAgents.getState().addToDraft(mention(path))
}

export function askAgentToExplain(entry: DirEntry): void {
  const text =
    entry.kind === 'dir'
      ? t('Explain what the folder {path} contains and how its parts fit together.', { path: mention(entry.path).trim() })
      : t('Explain what {path} does and how it fits in the project.', { path: mention(entry.path).trim() })
  void useAgents.getState().sendOrDraft(text)
}

/** Opens the Tasks view with a new task about this file, ready to be completed. */
export function newTaskFor(path: string): void {
  useTodos.getState().draft(mention(path))
  useLayout.getState().showCenter('tasks')
}
