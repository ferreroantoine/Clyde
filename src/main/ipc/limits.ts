import { handle } from './router'
import type { LimitsService } from '../limits/service'
import type { LimitsPoller } from '../limits/poller'
import type { LimitDiagnostic } from '@shared/limits'

export interface LimitsHandlerDeps {
  limits: LimitsService
  poller: LimitsPoller
  diagnose: (profileId: string) => Promise<LimitDiagnostic[]>
}

export function registerLimitsHandlers({ limits, poller, diagnose }: LimitsHandlerDeps): void {
  handle('limits:list', () => limits.allProfileLimits())
  handle('limits:session', ({ sessionId }) => limits.sessionUsage(sessionId))
  handle('limits:history', ({ profileId, days }) => limits.history(profileId, days))
  handle('limits:refresh', async ({ profileId }) => {
    await poller.refresh(profileId)
    return limits.allProfileLimits()
  })
  handle('limits:diagnose', ({ profileId }) => diagnose(profileId))
}
