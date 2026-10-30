import type { PermissionLevel } from '@shared/agent'
import type { ReasoningEffort } from '@shared/profiles'
import type { AgentDefinition } from '@shared/tasks'

/** Who answers the first message of the agent panel, and the settings of that session. */
export interface NextSession {
  /** A saved agent, or null for an account as it is. */
  agentId: string | null
  profileId: string
  /** Empty: the account's default model. */
  model: string
  effort: ReasoningEffort | ''
  permissionLevel: PermissionLevel
  mcpTools: string[]
  systemPrompt: string
}

interface ProfileLike {
  id: string
  usable: boolean
}

export function fromAgent(agent: AgentDefinition): NextSession {
  return {
    agentId: agent.id,
    profileId: agent.profileId,
    model: agent.model,
    effort: agent.effort,
    permissionLevel: agent.permissionLevel,
    mcpTools: [...agent.mcpTools],
    systemPrompt: agent.systemPrompt
  }
}

export function fromProfile(profileId: string, permissionLevel: PermissionLevel): NextSession {
  return { agentId: null, profileId, model: '', effort: '', permissionLevel, mcpTools: [], systemPrompt: '' }
}

/**
 * The choice to show: the one kept for the project while its agent and account still exist,
 * else the first account that can run. Null without any usable account.
 */
export function resolveNext(
  stored: NextSession | undefined,
  agents: readonly AgentDefinition[],
  profiles: readonly ProfileLike[],
  defaultLevel: PermissionLevel
): NextSession | null {
  const usable = (id: string) => profiles.some((p) => p.id === id && p.usable)
  if (stored) {
    if (stored.agentId) {
      const agent = agents.find((a) => a.id === stored.agentId)
      // The agent's account may have changed since: follow it.
      if (agent && usable(agent.profileId)) return { ...stored, profileId: agent.profileId }
    } else if (usable(stored.profileId)) {
      return stored
    }
  }
  const first = profiles.find((p) => p.usable)
  return first ? fromProfile(first.id, defaultLevel) : null
}
