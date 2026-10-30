import { handle } from './router'
import type { AgentDefinitionsService } from '../services/agent-definitions'

export function registerAgentDefinitionHandlers(agents: AgentDefinitionsService): void {
  handle('agents:list', () => agents.list())
  handle('agents:create', (input) => agents.create(input))
  handle('agents:update', (input) => agents.update(input))
  handle('agents:delete', ({ id }) => {
    agents.delete(id)
    return null
  })
}
