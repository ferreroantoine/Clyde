import { net } from 'electron'
import { AppError } from '@shared/errors'
import { isApiKind } from '@shared/profiles'
import { handle } from './router'
import type { ProfilesService } from '../services/profiles'
import type { PtyService } from '../services/pty'
import { buildProfileEnv, resolveClaudeBinary } from '../agents/claude-code/runtime'
import { testConnection, type QueryFn } from '../agents/claude-code/provider'
import { createAdapter, testApiConnection } from '../agents/api/clients'

export interface ProfileHandlerDeps {
  profiles: ProfilesService
  ptys: PtyService
  claudeCodePath: () => string
  query: () => Promise<QueryFn>
  clientApp: string
  fetch: typeof globalThis.fetch
}

export function registerProfileHandlers({ profiles, ptys, claudeCodePath, query, clientApp, fetch }: ProfileHandlerDeps): void {
  const target = (id: string) => {
    const profile = profiles.requireUsable(id)
    const apiKey = profile.auth === 'api-key' ? profiles.apiKey(id) : null
    const configDir = profiles.configDir(id)
    return {
      profile,
      apiKey,
      binary: resolveClaudeBinary(claudeCodePath()),
      env: buildProfileEnv(process.env, { configDir, apiKey }, clientApp),
      cwd: configDir
    }
  }

  handle('profiles:list', () => profiles.list())
  handle('profiles:create', (input) => profiles.create(input))
  handle('profiles:update', (input) => profiles.update(input))
  handle('profiles:delete', ({ id }) => {
    profiles.delete(id)
    return null
  })
  handle('profiles:test', ({ id }) => {
    const profile = profiles.requireUsable(id)
    if (isApiKind(profile.kind)) {
      const api = { kind: profile.kind, apiKey: profiles.apiKey(id), baseUrl: profile.baseUrl }
      return testApiConnection(createAdapter(api, fetch), api)
    }
    // net.fetch goes through Chromium's network stack, so system proxies apply.
    return testConnection({ query, fetch: (url, init) => net.fetch(url, init) }, target(id))
  })
  // Runs Claude Code's own login inside the profile's config dir. The IDE only relays the terminal.
  handle('profiles:login', ({ id, cols, rows }) => {
    const t = target(id)
    if (t.profile.kind !== 'claude-code' || t.profile.auth !== 'subscription') {
      throw new AppError('invalid_request', 'Only Claude subscription accounts sign in')
    }
    return ptys.create({
      cwd: t.cwd,
      cols,
      rows,
      command: { file: t.binary, args: ['auth', 'login', '--claudeai'], env: t.env, title: `Sign in: ${t.profile.name}` }
    })
  })
}
