import { t, tn } from './i18n'

/** One-time messages from main, e.g. what a data migration removed. */
export type AppNotice = { id: number; createdAt: number } & (
  | { type: 'mistral-removed'; payload: { profiles: string[]; agents: string[] } }
  /** Worktrees of the old task board that were neither merged nor abandoned, still on disk. */
  | { type: 'task-worktrees-left'; payload: { worktrees: Array<{ path: string; branch: string; repo: string }> } }
)

export function describeNotice(notice: AppNotice): { title: string; detail: string } {
  switch (notice.type) {
    case 'mistral-removed': {
      const { profiles, agents } = notice.payload
      const accounts = tn('Account removed: {list}.', 'Accounts removed: {list}.', profiles.length, { list: profiles.join(', ') })
      const saved = agents.length ? ` ${tn('Saved agent removed with them: {list}.', 'Saved agents removed with them: {list}.', agents.length, { list: agents.join(', ') })}` : ''
      return {
        title: t('Mistral is no longer supported'),
        detail: `${accounts}${saved} ${t('Past sessions stay in the history.')}`
      }
    }
    case 'task-worktrees-left': {
      const list = notice.payload.worktrees.map((w) => `${w.branch} (${w.path})`).join(', ')
      return {
        title: t('Tasks no longer use worktrees'),
        detail: `${tn(
          'This worktree of an unmerged task is still on disk: {list}.',
          'These worktrees of unmerged tasks are still on disk: {list}.',
          notice.payload.worktrees.length,
          { list }
        )} ${t('Clyde does not delete them: merge or remove them with git when you are ready (git worktree remove, git branch -D).')}`
      }
    }
  }
}
