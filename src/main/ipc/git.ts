import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import { handle } from './router'
import type { GitService } from '../git/service'
import type { CheckpointService } from '../git/checkpoints'

export const COMMIT_MESSAGE_SYSTEM = `You write git commit messages. You get the staged diff and the repository's recent commit subjects.
Write one commit message for the staged changes:
- a subject line of at most 72 characters, in the imperative mood ("Add", "Fix"), no final period;
- if the recent subjects use Conventional Commits ("feat(scope): …", "fix: …"), use that style too;
- write in the language the recent subjects use;
- then, only if the change is not obvious from the subject, a blank line and a short body (what and why, wrapped at 72 characters).
Answer with the message only: no quotes, no code fence, no comment.`

export function cleanCommitMessage(text: string): string {
  return text
    .replace(/^```[a-z]*\n?|```\s*$/g, '')
    .replace(/^["'«\s]+|["'»\s]+$/g, '')
    .trim()
}

export function registerGitHandlers(deps: {
  git: GitService
  checkpoints: CheckpointService
  trash: (abs: string) => Promise<void>
  /** Clyde's internal model (Settings › Memory & context). */
  complete: (system: string, prompt: string) => Promise<string>
}): void {
  const { git, checkpoints } = deps
  const root = () => {
    const repo = git.current()
    if (!repo) throw new AppError('invalid_request', t('The open folder is not in a git repository'))
    return repo.root
  }

  handle('git:status', () => git.status())
  handle('git:init', async () => {
    await git.init()
    return git.status()
  })
  handle('git:stage', async ({ paths }) => (await git.stage(paths), null))
  handle('git:stageAll', async () => (await git.stageAll(), null))
  handle('git:unstage', async ({ paths }) => (await git.unstage(paths), null))
  handle('git:unstageAll', async () => (await git.unstageAll(), null))
  handle('git:discard', async ({ paths }) => (await git.discard(paths), null))
  handle('git:diff', ({ path, mode, oldPath }) => git.diff(path, mode, oldPath))
  handle('git:applyHunk', async ({ path, mode, index, action }) => (await git.applyHunk(path, mode, index, action), null))
  handle('git:commit', async ({ message, amend, push }) => {
    const hash = await git.commit(message, { amend })
    if (push) await git.push()
    return hash
  })
  handle('git:lastMessage', () => git.lastMessage())
  handle('git:generateMessage', async () => {
    const { diff, stat, subjects } = await git.stagedSummary()
    if (!diff.trim()) throw new AppError('invalid_request', t('Stage some changes first'))
    const prompt = `Recent commit subjects:\n${subjects.map((s) => `- ${s}`).join('\n') || '(none)'}\n\nStaged files:\n${stat}\n\nStaged diff:\n${diff}`
    const message = cleanCommitMessage(await deps.complete(COMMIT_MESSAGE_SYSTEM, prompt))
    if (!message) throw new AppError('agent_error', t('The model wrote no message'))
    return message
  })
  handle('git:log', (opts) => git.log(opts))
  handle('git:commitFiles', ({ hash }) => git.commitFiles(hash))
  handle('git:commitDiff', ({ hash, path, oldPath }) => git.commitDiff(hash, path, oldPath))
  handle('git:revert', ({ hash }) => git.pick('revert', hash))
  handle('git:cherryPick', ({ hash }) => git.pick('cherry-pick', hash))
  handle('git:branches', () => git.branches())
  handle('git:checkout', async ({ ref }) => (await git.checkout(ref), null))
  handle('git:createBranch', async ({ name, from, checkout }) => (await git.createBranch(name, from, checkout), null))
  handle('git:deleteBranch', async ({ name, remote, force }) => (await git.deleteBranch(name, { remote, force }), null))
  handle('git:merge', ({ ref }) => git.merge(ref))
  handle('git:abort', async () => (await git.abort(), null))
  handle('git:continue', () => git.continueOperation())
  handle('git:fetch', async () => (await git.fetch(), null))
  handle('git:pull', () => git.pull())
  handle('git:push', async () => (await git.push(), null))
  handle('git:stashes', () => git.stashes())
  handle('git:stash', async ({ message, untracked }) => (await git.stash(message, untracked), null))
  handle('git:stashApply', ({ index, pop }) => git.stashApply(index, pop))
  handle('git:stashDrop', async ({ index }) => (await git.stashDrop(index), null))
  handle('git:checkpoints', () => (git.current() ? checkpoints.list(root()) : []))
  handle('git:checkpointChanges', ({ sessionId }) => checkpoints.changes(root(), sessionId))
  handle('git:restoreCheckpoint', ({ sessionId }) => checkpoints.restore(root(), sessionId, deps.trash))
  handle('git:ignored', ({ paths }) => git.ignored(paths))
  handle('git:fileSessions', () => (git.current() ? checkpoints.fileSessions(root()) : {}))
}
