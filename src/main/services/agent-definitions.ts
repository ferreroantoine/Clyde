import { t } from '@shared/i18n'
import { randomUUID } from 'node:crypto'
import { AppError } from '@shared/errors'
import type { PermissionLevel } from '@shared/agent'
import {
  agentDefinitionInputSchema,
  agentDefinitionUpdateSchema,
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentDefinitionUpdate
} from '@shared/tasks'
import type { Db } from './db/database'

interface Row {
  id: string
  name: string
  profile_id: string
  model: string
  effort: string
  system_prompt: string
  permission_level: string
  mcp_tools: string
  created_at: number
  updated_at: number
}

const toDefinition = (r: Row): AgentDefinition => ({
  id: r.id,
  name: r.name,
  profileId: r.profile_id,
  model: r.model,
  effort: (r.effort ?? '') as AgentDefinition['effort'],
  systemPrompt: r.system_prompt,
  permissionLevel: r.permission_level as PermissionLevel,
  mcpTools: JSON.parse(r.mcp_tools) as string[],
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

/** Saved agents. Deleting a profile deletes its agents (foreign key cascade). */
export class AgentDefinitionsService {
  constructor(
    private readonly db: Db,
    private readonly onChanged: (list: AgentDefinition[]) => void = () => undefined
  ) {}

  list(): AgentDefinition[] {
    return (this.db.prepare('SELECT * FROM agents ORDER BY name COLLATE NOCASE').all() as Row[]).map(toDefinition)
  }

  get(id: string): AgentDefinition {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new AppError('not_found', t('This agent no longer exists'))
    return toDefinition(row)
  }

  create(input: AgentDefinitionInput): AgentDefinition {
    const d = agentDefinitionInputSchema.parse(input)
    this.requireProfile(d.profileId)
    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO agents (id, name, profile_id, model, effort, system_prompt, permission_level, mcp_tools, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, d.name, d.profileId, d.model, d.effort, d.systemPrompt, d.permissionLevel, JSON.stringify(d.mcpTools), now, now)
    this.onChanged(this.list())
    return this.get(id)
  }

  update(input: AgentDefinitionUpdate): AgentDefinition {
    const d = agentDefinitionUpdateSchema.parse(input)
    const current = this.get(d.id)
    if (d.profileId) this.requireProfile(d.profileId)
    this.db
      .prepare(
        `UPDATE agents SET name = ?, profile_id = ?, model = ?, effort = ?, system_prompt = ?, permission_level = ?, mcp_tools = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        d.name ?? current.name,
        d.profileId ?? current.profileId,
        d.model ?? current.model,
        d.effort ?? current.effort,
        d.systemPrompt ?? current.systemPrompt,
        d.permissionLevel ?? current.permissionLevel,
        JSON.stringify(d.mcpTools ?? current.mcpTools),
        Date.now(),
        d.id
      )
    this.onChanged(this.list())
    return this.get(d.id)
  }

  delete(id: string): void {
    this.get(id)
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id)
    this.onChanged(this.list())
  }

  private requireProfile(id: string): void {
    if (!this.db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(id)) {
      throw new AppError('not_found', t('This account no longer exists'))
    }
  }
}
