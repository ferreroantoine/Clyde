import { net } from 'electron'
import { AppError } from '@shared/errors'
import { isApiKind } from '@shared/profiles'
import { handle } from './router'
import type { ProfilesService } from '../services/profiles'
import type { PtyService } from '../services/pty'
import { buildProfileEnv, resolveClaudeBinary } from '../agents/claude-code/runtime'
import { testConnection, type QueryFn } from '../agents/claude-code/provider'
import { createAdapter, testApiConnection } from '../agents/api/clients'
import { buildCodexEnv, probeCodex, testCodexConnection } from '../agents/codex/runtime'
import { spawnCli } from '../agents/cli/process'
import { resolveAntigravityBinary, resolveCodexBinary } from '../agents/cli/resolve'
import { spawnPty } from '../agents/cli/pty-process'
import { buildAgyEnv, runAgy, testAntigravityConnection } from '../agents/antigravity/runtime'

export interface ProfileHandlerDeps {
  profiles: ProfilesService
  ptys: PtyService
  claudeCodePath: () => string
  codexPath: () => string
  antigravityPath: () => string
  query: () => Promise<QueryFn>
  clientApp: string
  fetch: typeof globalThis.fetch
}

export function registerProfileHandlers({
  profiles,
  ptys,
  claudeCodePath,
  codexPath,
  antigravityPath,
  query,
  clientApp,
  fetch
}: ProfileHandlerDeps): void {
  const clientVersion = clientApp.split('/')[1] ?? '0.0.0'
  const codexTarget = (id: string) => {
    const home = profiles.configDir(id)
    return { binary: resolveCodexBinary(codexPath()), env: buildCodexEnv(process.env, home), cwd: home }
  }
  const agyTarget = (id: string) => {
    const home = profiles.configDir(id)
    return { binary: resolveAntigravityBinary(antigravityPath()), env: buildAgyEnv(process.env, home), cwd: home }
  }
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
    if (profile.kind === 'codex') {
      const t = codexTarget(id)
      return testCodexConnection(() => probeCodex(spawnCli, { ...t, clientVersion }))
    }
    if (profile.kind === 'antigravity') {
      const t = agyTarget(id)
      return testAntigravityConnection((args) => runAgy(spawnPty, t, args))
    }
    // net.fetch goes through Chromium's network stack, so system proxies apply.
    return testConnection({ query, fetch: (url, init) => net.fetch(url, init) }, target(id))
  })
  // Runs the CLI's own login inside the profile's config dir. The IDE only relays the terminal.
  handle('profiles:login', ({ id, cols, rows }) => {
    const profile = profiles.requireUsable(id)
    if (profile.kind === 'codex') {
      const t = codexTarget(id)
      return ptys.create({
        cwd: t.cwd,
        cols,
        rows,
        command: { file: t.binary, args: ['login'], env: t.env, title: `Sign in: ${profile.name}` }
      })
    }
    if (profile.kind === 'antigravity') {
      // Antigravity signs in on its first interactive start.
      const t = agyTarget(id)
      return ptys.create({ cwd: t.cwd, cols, rows, command: { file: t.binary, args: [], env: t.env, title: `Sign in: ${profile.name}` } })
    }
    const t = target(id)
    if (t.profile.kind !== 'claude-code' || t.profile.auth !== 'subscription') {
      throw new AppError('invalid_request', 'Only subscription accounts sign in')
    }
    return ptys.create({
      cwd: t.cwd,
      cols,
      rows,
      command: { file: t.binary, args: ['auth', 'login', '--claudeai'], env: t.env, title: `Sign in: ${t.profile.name}` }
    })
  })
}
