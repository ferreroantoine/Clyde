import { t } from '@shared/i18n'
import type { Todo } from '@shared/todos'
import { ENDED_STATUSES, useAgents } from '@/stores/agents'
import { useLayout } from '@/stores/layout'
import { profileById, useProfiles } from '@/stores/profiles'
import { useSavedAgents } from '@/stores/saved-agents'
import { useTodos } from '@/stores/todos'

export interface Owner {
  /** The saved agent's name, else the account's; "Me" for the user's own tasks. */
  name: string
  color: string | null
  /** The session can still take messages. */
  live: boolean
}

/** Who a task belongs to, from the live sessions and the project's history. */
export function useOwner(sessionId: string | null): Owner {
  const view = useAgents((s) => (sessionId ? s.sessions[sessionId] : undefined))
  const summary = useAgents((s) => (sessionId ? s.history.find((h) => h.id === sessionId) : undefined))
  const profiles = useProfiles((s) => s.profiles)
  const agents = useSavedAgents((s) => s.agents)
  if (!sessionId) return { name: t('Me'), color: null, live: false }
  const profile = profileById(profiles, view?.info.profileId ?? summary?.profileId)
  const agent = view?.info.agentId ? agents.find((a) => a.id === view.info.agentId) : undefined
  return {
    name: agent?.name ?? profile?.name ?? t('Agent'),
    color: profile?.color ?? null,
    live: !!view && !ENDED_STATUSES.has(view.info.status)
  }
}

/** Shows the session a task belongs to in the agent panel. */
export function openSession(sessionId: string): void {
  useLayout.getState().setAgentPanelOpen(true)
  void useAgents.getState().open(sessionId)
}

/**
 * "Hand to the agent": the active session gets the task at once and it joins its list; with
 * no session, the message waits in the panel's box and the new session's list takes it over.
 */
export async function handOver(todo: Todo): Promise<void> {
  const agents = useAgents.getState()
  const message = t('Add this task to your task list, then do it: {task}', { task: todo.text })
  const id = agents.activeId
  const view = id ? agents.sessions[id] : undefined
  if (id && view && !ENDED_STATUSES.has(view.info.status)) {
    if (!(await useTodos.getState().assign(todo.id, id))) return
    useLayout.getState().setAgentPanelOpen(true)
    await agents.sendOrDraft(message)
    return
  }
  agents.addToDraft(message)
}
