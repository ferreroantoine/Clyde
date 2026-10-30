import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import { isApiKind, type Profile } from '@shared/profiles'
import type { Settings } from '@shared/settings'
import type { ApiTarget } from '../agents/api/clients'
import type { ChatAdapter } from '../agents/api/chat'

export interface InternalTarget {
  profileId: string
  model: string
}

/**
 * Atelier's own small tasks (rolling summaries, session summaries, memory proposals and
 * consolidation, titles) go to a local model by default: the first Ollama account, or the one
 * chosen in Settings › Memory & context. Only when there is none does a task use the account
 * it works for, so subscriptions are not spent on housekeeping by surprise.
 */
export class InternalModel {
  constructor(
    private readonly deps: {
      settings: () => Settings['memory']
      profiles: () => Profile[]
      apiKey: (profileId: string) => string | null
      createAdapter: (target: ApiTarget) => ChatAdapter
    }
  ) {}

  /** The account and model that would run a task, or null when none fits. */
  target(fallback?: InternalTarget): InternalTarget | null {
    const memory = this.deps.settings()
    const usable = this.deps.profiles().filter((p) => p.usable && isApiKind(p.kind))
    const chosen = usable.find((p) => p.id === memory.internalProfileId)
    if (chosen) return { profileId: chosen.id, model: memory.internalModel || chosen.defaultModel }
    const ollama = usable.find((p) => p.kind === 'ollama')
    if (ollama) return { profileId: ollama.id, model: memory.internalModel || ollama.defaultModel }
    return fallback ?? null
  }

  async complete(request: { system: string; prompt: string; signal?: AbortSignal; fallback?: InternalTarget }): Promise<string> {
    const target = this.target(request.fallback)
    if (!target) throw new AppError('invalid_request', t('No account for Atelier’s own tasks. Add an Ollama account, or choose one in Settings › Memory & context.'))
    const profile = this.deps.profiles().find((p) => p.id === target.profileId)
    if (!profile || !isApiKind(profile.kind)) throw new AppError('invalid_request', t('This account cannot run Atelier’s own tasks; choose an API or Ollama account.'))
    const adapter = this.deps.createAdapter({ kind: profile.kind, apiKey: this.deps.apiKey(profile.id), baseUrl: profile.baseUrl })
    const model = target.model || (await adapter.listModels())[0]?.value
    if (!model) throw new AppError('invalid_request', t('This account lists no model. Choose one by name.'))
    let text = ''
    for await (const event of adapter.stream({
      model,
      system: request.system,
      messages: [{ role: 'user', text: request.prompt }],
      tools: [],
      signal: request.signal ?? AbortSignal.timeout(120_000)
    })) {
      if (event.type === 'done') text = event.text
    }
    return text.trim()
  }
}
