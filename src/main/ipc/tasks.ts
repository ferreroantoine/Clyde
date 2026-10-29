import { handle } from './router'
import type { AgentDefinitionsService } from '../services/agent-definitions'
import type { TaskService } from '../agents/tasks'

export function registerTaskHandlers(agents: AgentDefinitionsService, tasks: TaskService): void {
  handle('agents:list', () => agents.list())
  handle('agents:create', (input) => agents.create(input))
  handle('agents:update', (input) => agents.update(input))
  handle('agents:delete', ({ id }) => {
    agents.delete(id)
    return null
  })
  handle('tasks:list', () => tasks.list())
  handle('tasks:create', (input) => tasks.create(input))
  handle('tasks:start', ({ id }) => tasks.start(id))
  handle('tasks:requestChanges', ({ id, comments }) => tasks.requestChanges(id, comments))
  handle('tasks:changes', ({ id }) => tasks.changes(id))
  handle('tasks:fileDiff', ({ id, path }) => tasks.fileDiff(id, path))
  handle('tasks:merge', ({ id }) => tasks.merge(id))
  handle('tasks:abandon', ({ id }) => tasks.abandon(id))
  handle('tasks:reorder', ({ id, beforeId }) => tasks.reorder(id, beforeId))
  handle('tasks:delete', async ({ id }) => {
    await tasks.delete(id)
    return null
  })
}
