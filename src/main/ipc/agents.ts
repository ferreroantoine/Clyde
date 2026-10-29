import { handle } from './router'
import type { AgentManager } from '../agents/manager'

export function registerAgentHandlers(agents: AgentManager): void {
  handle('agent:list', () => agents.list())
  handle('agent:start', (req) => agents.start(req))
  handle('agent:send', ({ sessionId, text }) => {
    agents.send(sessionId, text)
    return null
  })
  handle('agent:interrupt', async ({ sessionId }) => {
    await agents.interrupt(sessionId)
    return null
  })
  handle('agent:stop', ({ sessionId }) => {
    agents.stop(sessionId)
    return null
  })
  handle('agent:approve', ({ sessionId, requestId, decision, message }) => {
    agents.answer(sessionId, requestId, decision, message)
    return null
  })
}
