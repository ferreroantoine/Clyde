/** One-time messages from main, e.g. what a data migration removed. */
export type AppNotice = { id: number; createdAt: number } & {
  type: 'mistral-removed'
  payload: { profiles: string[]; agents: string[] }
}

export function describeNotice(notice: AppNotice): { title: string; detail: string } {
  switch (notice.type) {
    case 'mistral-removed': {
      const { profiles, agents } = notice.payload
      const accounts = `${profiles.length === 1 ? 'Account' : 'Accounts'} removed: ${profiles.join(', ')}.`
      const saved = agents.length ? ` Saved ${agents.length === 1 ? 'agent' : 'agents'} removed with them: ${agents.join(', ')}.` : ''
      return {
        title: 'Mistral is no longer supported',
        detail: `${accounts}${saved} Past sessions stay in the history.`
      }
    }
  }
}
