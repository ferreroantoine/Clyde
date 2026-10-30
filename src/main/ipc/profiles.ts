import { t } from '@shared/i18n'
import { net } from 'electron'
import { AppError } from '@shared/errors'
import { isApiKind, type ConnectionResult, type ModelOption, type ProfileKind, type ReasoningEffort } from '@shared/profiles'
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
import { AGY_EFFORTS, buildAgyEnv, runAgy, testAntigravityConnection } from '../agents/antigravity/runtime'
import type { CliDetectService } from '../services/cli-detect'

export interface ProfileHandlerDeps {
  profiles: ProfilesService
  ptys: PtyService
  claudeCodePath: () => string
  codexPath: () => string
  antigravityPath: () => string
  cli: CliDetectService
  query: () => Promise<QueryFn>
  clientApp: string
  fetch: typeof globalThis.fetch
}

/** `agy --effort` takes the same levels for every model (`agy --help`); it lists no per-model levels. */
function withEfforts(kind: ProfileKind, models: ModelOption[]): ModelOption[] {
  if (kind !== 'antigravity') return models
  return models.map((m) => (m.efforts ? m : { ...m, efforts: AGY_EFFORTS as ReasoningEffort[] }))
}

export function registerProfileHandlers({
  profiles,
  ptys,
  claudeCodePath,
  codexPath,
  antigravityPath,
  cli,
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
  handle('cli:status', ({ refresh }) => cli.status(refresh))
  handle('profiles:create', (input) => profiles.create(input))
  handle('profiles:update', (input) => profiles.update(input))
  handle('profiles:delete', ({ id }) => {
    profiles.delete(id)
    return null
  })
  // The model picker's list, kept a few minutes: listing starts a CLI or calls the API.
  const modelCache = new Map<string, { at: number; models: ModelOption[] }>()
  const test = (id: string): Promise<ConnectionResult> => {
    const profile = profiles.requireUsable(id)
    if (isApiKind(profile.kind)) {
      const api = { kind: profile.kind, apiKey: profiles.apiKey(id), baseUrl: profile.baseUrl }
      return testApiConnection(createAdapter(api, fetch), api)
    }
    if (profile.kind === 'codex') {
      const tgt = codexTarget(id)
      return testCodexConnection(() => probeCodex(spawnCli, { ...tgt, clientVersion }))
    }
    if (profile.kind === 'antigravity') {
      const tgt = agyTarget(id)
      return testAntigravityConnection((args) => runAgy(spawnPty, tgt, args))
    }
    // net.fetch goes through Chromium's network stack, so system proxies apply.
    return testConnection({ query, fetch: (url, init) => net.fetch(url, init) }, target(id))
  }
  handle('profiles:test', async ({ id }) => {
    const result = await test(id)
    if (result.ok) modelCache.set(id, { at: Date.now(), models: withEfforts(profiles.requireUsable(id).kind, result.models) })
    return { ...result, models: withEfforts(profiles.requireUsable(id).kind, result.models) }
  })
  handle('profiles:models', async ({ id, refresh }) => {
    const cached = modelCache.get(id)
    if (cached && !refresh && Date.now() - cached.at < 10 * 60_000) return cached.models
    const result = await test(id)
    if (!result.ok) throw new AppError('agent_error', result.detail ?? result.status)
    const models = withEfforts(profiles.requireUsable(id).kind, result.models)
    modelCache.set(id, { at: Date.now(), models })
    return models
  })
  // Runs the CLI's own login inside the profile's config dir. The IDE only relays the terminal.
  handle('profiles:login', ({ id, cols, rows }) => {
    const profile = profiles.requireUsable(id)
    if (profile.kind === 'codex') {
      const tgt = codexTarget(id)
      return ptys.create({
        cwd: tgt.cwd,
        cols,
        rows,
        command: { file: tgt.binary, args: ['login'], env: tgt.env, title: t('Sign in: {name}', { name: profile.name }) }
      })
    }
    if (profile.kind === 'antigravity') {
      // Antigravity signs in on its first interactive start.
      const tgt = agyTarget(id)
      return ptys.create({ cwd: tgt.cwd, cols, rows, command: { file: tgt.binary, args: [], env: tgt.env, title: t('Sign in: {name}', { name: profile.name }) } })
    }
    const tgt = target(id)
    if (tgt.profile.kind !== 'claude-code' || tgt.profile.auth !== 'subscription') {
      throw new AppError('invalid_request', t('Only subscription accounts sign in'))
    }
    return ptys.create({
      cwd: tgt.cwd,
      cols,
      rows,
      command: { file: tgt.binary, args: ['auth', 'login', '--claudeai'], env: tgt.env, title: t('Sign in: {name}', { name: tgt.profile.name }) }
    })
  })
}
