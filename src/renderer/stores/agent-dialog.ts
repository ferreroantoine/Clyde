import { create } from 'zustand'
import type { AgentDefinition } from '@shared/tasks'

interface AgentDialogState {
  /** The saved agent being edited, 'new' while creating one, null when closed. */
  editing: AgentDefinition | 'new' | null
  /** Called with the agent once saved (the agent panel selects a new agent). */
  onSaved: ((agent: AgentDefinition) => void) | null
  open: (agent: AgentDefinition | 'new', onSaved?: (agent: AgentDefinition) => void) => void
  close: () => void
}

/** One agent dialog for the whole app: the agent panel, Settings and the palette open it. */
export const useAgentDialog = create<AgentDialogState>()((set) => ({
  editing: null,
  onSaved: null,
  open: (agent, onSaved) => set({ editing: agent, onSaved: onSaved ?? null }),
  close: () => set({ editing: null, onSaved: null })
}))
