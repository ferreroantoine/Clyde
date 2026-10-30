import type { Db } from './database'

/**
 * Mistral is no longer a provider. Its accounts are deleted with their keys and the saved
 * agents that use them (tasks keep their history, unassigned). Sessions already in the
 * history stay, labelled "Mistral (removed)". A notice tells the user what went.
 */
export function removeMistral(db: Db): void {
  const profiles = db.prepare("SELECT id, name FROM profiles WHERE kind = 'mistral' ORDER BY created_at").all() as Array<{
    id: string
    name: string
  }>
  if (profiles.length === 0) return
  const ids = profiles.map((p) => p.id)
  const marks = ids.map(() => '?').join(', ')
  const agents = db.prepare(`SELECT id, name FROM agents WHERE profile_id IN (${marks}) ORDER BY created_at`).all(...ids) as Array<{
    id: string
    name: string
  }>
  // Explicit rather than relying on ON DELETE, which needs foreign_keys on for this connection.
  if (agents.length) {
    const agentMarks = agents.map(() => '?').join(', ')
    const agentIds = agents.map((a) => a.id)
    db.prepare(`UPDATE tasks SET agent_id = NULL WHERE agent_id IN (${agentMarks})`).run(...agentIds)
    db.prepare(`DELETE FROM agents WHERE id IN (${agentMarks})`).run(...agentIds)
  }
  db.prepare(`DELETE FROM secrets WHERE profile_id IN (${marks})`).run(...ids)
  db.prepare(`DELETE FROM profiles WHERE id IN (${marks})`).run(...ids)
  db.prepare('INSERT INTO app_notices (type, payload, created_at) VALUES (?, ?, ?)').run(
    'mistral-removed',
    JSON.stringify({ profiles: profiles.map((p) => p.name), agents: agents.map((a) => a.name) }),
    Date.now()
  )
}
