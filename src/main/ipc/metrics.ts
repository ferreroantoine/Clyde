import { handle } from './router'
import type { MetricsService } from '../metrics/metrics'

export function registerMetricsHandlers(metrics: MetricsService): void {
  handle('metrics:dashboard', ({ range }) => metrics.dashboard(range))
  handle('metrics:transcript', ({ sessionId }) => metrics.transcript(sessionId))
  handle('pricing:list', () => metrics.prices())
  handle('pricing:save', (input) => metrics.savePrice(input))
  handle('pricing:delete', ({ id }) => metrics.deletePrice(id))
}
