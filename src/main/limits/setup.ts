import { Notification } from 'electron'
import { parseCodexRateLimits, type LimitDiagnostic, type LimitReading } from '@shared/limits'
import type { AgentEventEnvelope, AgentSessionInfo } from '@shared/agent'
import type { Profile } from '@shared/profiles'
import { redact } from '@shared/redact'
import type { Settings } from '@shared/settings'
import type { Db } from '../services/db/database'
import type { ProfilesService } from '../services/profiles'
import { broadcast } from '../ipc/events'
import type { Logger } from '../logger'
import { buildProfileEnv, resolveClaudeBinary } from '../agents/claude-code/runtime'
import { probeClaudeLimits, type QueryFn } from '../agents/claude-code/provider'
import { buildCodexEnv, probeCodex } from '../agents/codex/runtime'
import { buildAgyEnv, runAgy } from '../agents/antigravity/runtime'
import { spawnCli } from '../agents/cli/process'
import { spawnPty } from '../agents/cli/pty-process'
import { resolveAntigravityBinary, resolveCodexBinary } from '../agents/cli/resolve'
import { LimitsService } from './service'
import { BridgeWatcher, LimitsPoller } from './poller'
import { installBridge, readBridge } from './claude-bridge'

export interface LimitsSetupDeps {
  db: Db
  profiles: ProfilesService
  sessions: () => AgentSessionInfo[]
  settings: () => Settings
  query: () => Promise<QueryFn>
  clientApp: string
  log: Logger
}

/** Wires plan limits: the service, background reads, Claude's status line bridge, alerts and the diagnostic. */
export function setupLimits(deps: LimitsSetupDeps) {
  const { profiles, settings, log } = deps
  const limits = new LimitsService(deps.db, {
    profiles: () => profiles.list(),
    activeSessions: deps.sessions,
    thresholds: () => ({ fiveHour: settings().usage.fiveHourAlerts, sevenDay: settings().usage.sevenDayAlerts }),
    onProfile: (l) => broadcast('limits:changed', l),
    onSession: (sessionId, usage) => broadcast('limits:sessionChanged', { sessionId, usage }),
    onAlert: (alert) => {
      broadcast('limits:alert', alert)
      if (Notification.isSupported()) {
        new Notification({
          title: `${alert.profileName}: ${alert.label} at ${Math.round(alert.usedPct)}%`,
          body: alert.resetsAt ? `Resets ${new Date(alert.resetsAt).toLocaleString()}.` : 'Atelier will tell you when it resets.'
        }).show()
      }
    }
  })

  const claudeTarget = (p: Profile) => {
    const dir = profiles.configDir(p.id)
    return { binary: resolveClaudeBinary(settings().cli.claudeCodePath), env: buildProfileEnv(process.env, { configDir: dir, apiKey: null }, deps.clientApp), cwd: dir }
  }
  const codexTarget = (p: Profile) => {
    const home = profiles.configDir(p.id)
    return { binary: resolveCodexBinary(settings().cli.codexPath), env: buildCodexEnv(process.env, home), cwd: home, clientVersion: deps.clientApp.split('/')[1] ?? '0' }
  }

  const read = async (p: Profile): Promise<LimitReading[]> => {
    if (p.kind === 'claude-code') return (await probeClaudeLimits(await deps.query(), claudeTarget(p))).readings
    if (p.kind === 'codex') {
      const probe = await probeCodex(spawnCli, codexTarget(p))
      return probe.rateLimits ? parseCodexRateLimits(probe.rateLimits.rateLimits, probe.rateLimits.rateLimitsByLimitId) : []
    }
    return []
  }

  const poller = new LimitsPoller({
    profiles: () => profiles.list(),
    activeSessions: deps.sessions,
    intervalMinutes: () => settings().usage.refreshMinutes,
    read,
    ingest: (id, readings) => limits.ingest(id, readings),
    log: (message, err) => log.warn(message, err)
  })

  const bridge = new BridgeWatcher((profileId, readings) => limits.ingest(profileId, readings))
  /** Installs the status line bridge in every Claude subscription profile and watches its file. */
  const syncProfiles = (list: Profile[]) => {
    const dirs: Array<{ profileId: string; dir: string }> = []
    for (const p of list) {
      if (p.kind !== 'claude-code' || p.auth !== 'subscription') continue
      const dir = profiles.configDir(p.id)
      try {
        if (!installBridge(dir)) log.warn(`left ${p.name}'s Claude settings alone: settings.json is not valid JSON`)
      } catch (err) {
        log.warn(`could not install the status line bridge for ${p.name}`, err)
      }
      dirs.push({ profileId: p.id, dir })
    }
    bridge.sync(dirs)
  }

  /** Feeds turn token counts to the per-session attribution. */
  const onAgentEvent = (envelope: AgentEventEnvelope) => {
    if (envelope.event.type !== 'turn_end') return
    const session = deps.sessions().find((s) => s.id === envelope.sessionId)
    const profile = session && profiles.list().find((p) => p.id === session.profileId)
    if (!session || profile?.auth !== 'subscription') return
    limits.onTurnEnd(session.profileId, session.id, envelope.event.inputTokens + envelope.event.outputTokens)
  }

  /** Asks every source of one account and returns what each answered, for Settings › Usage. */
  const diagnose = async (profileId: string): Promise<LimitDiagnostic[]> => {
    const p = profiles.get(profileId)
    const attempt = async (source: string, run: () => Promise<string>): Promise<LimitDiagnostic> => {
      try {
        return { source, ok: true, output: redact(await run()) }
      } catch (err) {
        return { source, ok: false, output: redact((err as Error).message) }
      }
    }
    const json = (v: unknown) => JSON.stringify(v, null, 2)
    if (p.kind === 'claude-code') {
      return Promise.all([
        attempt('Claude Code /usage (Agent SDK)', async () => json((await probeClaudeLimits(await deps.query(), claudeTarget(p))).raw)),
        attempt('Status line bridge', async () => {
          const readings = readBridge(profiles.configDir(p.id))
          if (!readings.length) throw new Error('No reading yet: Claude Code has not run the status line with limits for this account.')
          return json(readings)
        })
      ])
    }
    if (p.kind === 'codex') {
      return [await attempt('Codex account/rateLimits/read', async () => json((await probeCodex(spawnCli, codexTarget(p))).rateLimits))]
    }
    if (p.kind === 'antigravity') {
      return [
        await attempt('agy -p "/usage"', async () => {
          const home = profiles.configDir(p.id)
          const target = { binary: resolveAntigravityBinary(settings().cli.antigravityPath), env: buildAgyEnv(process.env, home), cwd: home }
          const { code, output } = await runAgy(spawnPty, target, ['-p', '/usage', '--output-format', 'json'], 90_000)
          if (code !== 0) throw new Error(`agy exited with code ${code}:\n${output}`)
          return output
        })
      ]
    }
    return [{ source: 'API account', ok: true, output: 'API accounts have no plan limits; Atelier shows their cost instead.' }]
  }

  return {
    limits,
    poller,
    syncProfiles,
    onAgentEvent,
    diagnose,
    ingest: (profileId: string, readings: LimitReading[], sessionId: string) => limits.ingest(profileId, readings, sessionId),
    dispose: async () => {
      poller.stop()
      await bridge.dispose()
    }
  }
}
