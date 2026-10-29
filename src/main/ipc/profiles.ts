import { net } from 'electron'
import { AppError } from '@shared/errors'
import { handle } from './router'
import type { ProfilesService } from '../services/profiles'
import type { PtyService } from '../services/pty'
import { buildProfileEnv, resolveClaudeBinary } from '../agents/claude-code/runtime'
import { testConnection, type QueryFn } from '../agents/claude-code/provider'

export interface ProfileHandlerDeps {
  profiles: ProfilesService
  ptys: PtyService
  claudeCodePath: () => string
  query: () => Promise<QueryFn>
  clientApp: string
}

export function registerProfileHandlers({ profiles, ptys, claudeCodePath, query, clientApp }: ProfileHandlerDeps): void {
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
  handle('profiles:test', ({ id }) =>
    // net.fetch goes through Chromium's network stack, so system proxies apply.
    testConnection({ query, fetch: (url, init) => net.fetch(url, init) }, target(id))
  )
  // Runs Claude Code's own login inside the profile's config dir. The IDE only relays the terminal.
  handle('profiles:login', ({ id, cols, rows }) => {
    const t = target(id)
    if (t.profile.auth !== 'subscription') throw new AppError('invalid_request', 'API key profiles do not sign in')
    return ptys.create({
      cwd: t.cwd,
      cols,
      rows,
      command: { file: t.binary, args: ['auth', 'login', '--claudeai'], env: t.env, title: `Sign in: ${t.profile.name}` }
    })
  })
}
