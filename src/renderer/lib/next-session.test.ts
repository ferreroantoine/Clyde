import { describe, expect, it } from 'vitest'
import type { AgentDefinition } from '@shared/tasks'
import { fromAgent, fromProfile, resolveNext } from './next-session'

const agent: AgentDefinition = {
  id: 'a1',
  name: 'Reviewer',
  profileId: 'p2',
  model: 'opus',
  effort: 'high',
  systemPrompt: 'Review.',
  permissionLevel: 'files-auto',
  mcpTools: ['mcp__git__log'],
  createdAt: 0,
  updatedAt: 0
}
const profiles = [
  { id: 'p1', usable: true },
  { id: 'p2', usable: true },
  { id: 'p3', usable: false }
]

describe('resolveNext', () => {
  it('keeps the choice made for the project', () => {
    const stored = { ...fromProfile('p2', 'autonomous'), model: 'sonnet' }
    expect(resolveNext(stored, [agent], profiles, 'validate-all')).toEqual(stored)
    expect(resolveNext(fromAgent(agent), [agent], profiles, 'validate-all')).toEqual(fromAgent(agent))
  })

  it('follows a saved agent moved to another account', () => {
    const stored = fromAgent(agent)
    const moved = { ...agent, profileId: 'p1' }
    expect(resolveNext(stored, [moved], profiles, 'validate-all')?.profileId).toBe('p1')
  })

  it('falls back to the first usable account when the agent or account is gone', () => {
    expect(resolveNext(fromAgent(agent), [], profiles, 'validate-all')).toEqual(fromProfile('p1', 'validate-all'))
    expect(resolveNext(fromProfile('p3', 'autonomous'), [], profiles, 'files-auto')).toEqual(fromProfile('p1', 'files-auto'))
    expect(resolveNext(undefined, [], profiles, 'validate-all')).toEqual(fromProfile('p1', 'validate-all'))
  })

  it('is null without a usable account', () => {
    expect(resolveNext(undefined, [], [{ id: 'p3', usable: false }], 'validate-all')).toBeNull()
  })

  it('copies a saved agent with its settings', () => {
    expect(fromAgent(agent)).toEqual({
      agentId: 'a1',
      profileId: 'p2',
      model: 'opus',
      effort: 'high',
      permissionLevel: 'files-auto',
      mcpTools: ['mcp__git__log'],
      systemPrompt: 'Review.'
    })
  })
})
