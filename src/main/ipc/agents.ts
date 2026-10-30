import { handle } from './router'
import { CONTINUE_MESSAGE, type AgentManager } from '../agents/manager'
import type { MetricsService } from '../metrics/metrics'
import type { MediaStore } from '../agents/media'

export function registerAgentHandlers(
  agents: AgentManager,
  deps: { metrics: Pick<MetricsService, 'history' | 'stored'>; media: Pick<MediaStore, 'read'>; workspaceRoot: () => string | null }
): void {
  handle('agent:list', () => agents.list())
  handle('agent:start', (req) => agents.start(req))
  handle('agent:history', ({ cwd }) => {
    const root = cwd ?? deps.workspaceRoot()
    return root ? deps.metrics.history(root) : []
  })
  handle('agent:load', ({ sessionId }) => {
    const stored = deps.metrics.stored(sessionId)
    // A live session's status comes from the manager; the database may lag behind.
    const live = agents.get(sessionId)
    return live ? { ...stored, info: live } : stored
  })
  handle('agent:media', ({ sessionId, id }) => deps.media.read(sessionId, id))
  handle('agent:resume', async ({ sessionId, continue: carryOn }) => {
    const info = await agents.resume(sessionId)
    if (carryOn) agents.send(sessionId, CONTINUE_MESSAGE)
    return info
  })
  handle('agent:send', ({ sessionId, text }) => {
    agents.send(sessionId, text)
    return null
  })
  handle('agent:interrupt', async ({ sessionId }) => {
    await agents.interrupt(sessionId)
    return null
  })
  handle('agent:compact', async ({ sessionId }) => {
    await agents.compact(sessionId)
    return null
  })
  handle('agent:continueWithSummary', ({ sessionId }) => agents.continueWithSummary(sessionId))
  handle('agent:stop', ({ sessionId }) => {
    agents.stop(sessionId)
    return null
  })
  handle('agent:answerQuestion', ({ sessionId, requestId, answers }) => {
    agents.answerQuestion(sessionId, requestId, answers)
    return null
  })
  handle('agent:approve', ({ sessionId, requestId, decision, message }) => {
    agents.answer(sessionId, requestId, decision, message)
    return null
  })
}
