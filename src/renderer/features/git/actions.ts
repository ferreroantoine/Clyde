import { intlLocale, t, tk } from '@shared/i18n'
import type { GitCommit, GitFileState } from '@shared/git'
import { invoke } from '@/lib/ipc'
import { askText } from '@/components/PromptDialog'
import { useAgents } from '@/stores/agents'
import { useEditor } from '@/stores/editor'
import { useGit } from '@/stores/git'
import { useLayout } from '@/stores/layout'
import { notify } from '@/stores/notifications'

/** One letter per state, as in VS Code and IntelliJ. */
export const STATE_LETTER: Record<GitFileState, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
  untracked: 'U',
  conflicted: '!'
}

export const STATE_LABEL: Record<GitFileState, string> = {
  modified: tk('Modified'),
  added: tk('Added'),
  deleted: tk('Deleted'),
  renamed: tk('Renamed'),
  copied: tk('Copied'),
  'type-changed': tk('Type changed'),
  untracked: tk('New'),
  conflicted: tk('Conflict')
}

export const STATE_COLOR: Record<GitFileState, string> = {
  modified: 'text-warning',
  added: 'text-success',
  untracked: 'text-success',
  deleted: 'text-destructive',
  conflicted: 'text-destructive',
  renamed: 'text-primary',
  copied: 'text-primary',
  'type-changed': 'text-warning'
}

/** A time today, a date otherwise. */
export const dateTime = (ms: number) => {
  const date = new Date(ms)
  const today = date.toDateString() === new Date().toDateString()
  return date.toLocaleString(intlLocale(), today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

export const nameOf = (path: string) => path.split('/').pop() ?? path
export const dirOf = (path: string) => path.split('/').slice(0, -1).join('/')

/** Opens the file in the editor, when it is inside the open folder. */
export function openFile(path: string): void {
  const local = useGit.getState().toWorkspace(path)
  if (local === null) {
    notify.info(t('This file is outside the open folder'))
    return
  }
  useGit.getState().show(null)
  void useEditor.getState().open(local)
}

export function openSession(sessionId: string): void {
  useLayout.getState().setAgentPanelOpen(true)
  void useAgents.getState().open(sessionId)
}

// Agents

export function reviewChanges(): void {
  void useAgents
    .getState()
    .sendOrDraft(
      t('Review my uncommitted changes: run git status and git diff HEAD (and read the new files). Point out bugs, risks and possible simplifications, file by file. Do not change anything.')
    )
}

export function explainCommit(commit: GitCommit): void {
  void useAgents
    .getState()
    .sendOrDraft(t('Explain the commit {hash} ("{subject}"): run git show {hash}, then say what it changes and why, as far as the code tells.', { hash: commit.short, subject: commit.subject }))
}

export function resolveConflicts(files: string[]): void {
  void useAgents
    .getState()
    .sendOrDraft(
      t('Resolve the git conflicts in these files: {files}. Keep the intent of both sides; when it is unclear, ask me. Then stage the resolved files with git add. Do not commit.', {
        files: files.map((f) => `\`${f}\``).join(', ')
      })
    )
}

// Commands that need a confirmation

export async function discard(paths: string[], untracked: number): Promise<void> {
  const question =
    paths.length === 1
      ? untracked
        ? t('Delete the new file {name}? It goes to the Recycle Bin.', { name: nameOf(paths[0] as string) })
        : t('Discard the changes to {name}? This cannot be undone.', { name: nameOf(paths[0] as string) })
      : t('Discard the changes to {count} files? Tracked files cannot be recovered; new files go to the Recycle Bin.', { count: paths.length })
  if (!window.confirm(question)) return
  await useGit.getState().run('discard', t('Could not discard the changes'), () => invoke('git:discard', { paths }))
}

export async function checkout(ref: string): Promise<void> {
  await useGit.getState().run('checkout', t('Could not check out {ref}', { ref }), () => invoke('git:checkout', { ref }))
}

export async function createBranch(from?: string): Promise<void> {
  const name = await askText({
    title: from ? t('New branch from {ref}', { ref: from.slice(0, 12) }) : t('New branch'),
    placeholder: t('feature/my-change'),
    confirm: t('Create and check out'),
    validate: (v) => (/[\s~^:?*[\\]|\.\.|@\{|^-|^\/|\/$|\.lock$/.test(v) ? t('This name is not allowed') : null)
  })
  if (!name) return
  await useGit.getState().run('branch', t('Could not create the branch'), () => invoke('git:createBranch', { name, ...(from ? { from } : {}), checkout: true }))
}

export async function pick(kind: 'revert' | 'cherry-pick', commit: GitCommit): Promise<void> {
  const question =
    kind === 'revert'
      ? t('Create a commit that undoes {hash} ("{subject}")?', { hash: commit.short, subject: commit.subject })
      : t('Apply {hash} ("{subject}") on the current branch?', { hash: commit.short, subject: commit.subject })
  if (!window.confirm(question)) return
  const git = useGit.getState()
  const result = await git.run(kind, kind === 'revert' ? t('Could not revert') : t('Could not cherry-pick'), () =>
    invoke(kind === 'revert' ? 'git:revert' : 'git:cherryPick', { hash: commit.hash })
  )
  git.report(result, kind === 'revert' ? t('Reverted {hash}', { hash: commit.short }) : t('Applied {hash}', { hash: commit.short }))
}

export function copyText(text: string): void {
  navigator.clipboard.writeText(text).then(
    () => notify.success(t('Copied')),
    (err) => notify.error(t('Could not copy'), err)
  )
}
