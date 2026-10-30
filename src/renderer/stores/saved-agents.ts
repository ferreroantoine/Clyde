import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { AgentDefinition, AgentDefinitionInput, AgentDefinitionUpdate } from '@shared/tasks'
import { invoke, on } from '@/lib/ipc'
import { notify } from './notifications'

interface SavedAgentsState {
  agents: AgentDefinition[]
  init: () => () => void
  saveAgent: (input: AgentDefinitionInput | AgentDefinitionUpdate) => Promise<AgentDefinition | null>
  deleteAgent: (id: string) => Promise<void>
}

/** The saved agents (account, model, instructions, permissions, MCP tools), shared by every picker. */
export const useSavedAgents = create<SavedAgentsState>()((set) => ({
  agents: [],

  init: () => {
    const off = on('agents:changed', (agents) => set({ agents }))
    invoke('agents:list')
      .then((agents) => set({ agents }))
      .catch(() => undefined)
    return off
  },

  saveAgent: async (input) => {
    try {
      return 'id' in input ? await invoke('agents:update', input) : await invoke('agents:create', input)
    } catch (err) {
      notify.error(t('Could not save the agent'), err)
      return null
    }
  },

  deleteAgent: async (id) => {
    await invoke('agents:delete', { id }).catch((err) => notify.error(t('Could not delete the agent'), err))
  }
}))
