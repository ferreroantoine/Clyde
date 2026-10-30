import type { AppNotice } from '@shared/notices'
import type { Db } from './db/database'

const KNOWN = new Set<AppNotice['type']>(['mistral-removed', 'task-worktrees-left'])

export class NoticesService {
  constructor(private readonly db: Db) {}

  /** Notices not shown yet, marked as shown: each one reaches the user once. */
  takePending(now = Date.now()): AppNotice[] {
    const rows = this.db.prepare('SELECT id, type, payload, created_at FROM app_notices WHERE shown_at IS NULL ORDER BY id').all() as Array<{
      id: number
      type: string
      payload: string
      created_at: number
    }>
    const out: AppNotice[] = []
    for (const row of rows) {
      if (!KNOWN.has(row.type as AppNotice['type'])) continue
      try {
        out.push({ id: row.id, type: row.type, payload: JSON.parse(row.payload), createdAt: row.created_at } as AppNotice)
      } catch {
        // unreadable payload: drop it below with the rest
      }
    }
    if (rows.length) this.db.prepare('UPDATE app_notices SET shown_at = ? WHERE shown_at IS NULL').run(now)
    return out
  }
}
