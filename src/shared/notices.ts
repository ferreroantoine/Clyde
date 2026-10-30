import { t, tn } from './i18n'

/** One-time messages from main, e.g. what a data migration removed. */
export type AppNotice = { id: number; createdAt: number } & {
  type: 'mistral-removed'
  payload: { profiles: string[]; agents: string[] }
}

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
  }
}
