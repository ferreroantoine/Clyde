import { configExportSchema, CONFIG_FORMAT, type ConfigExport, type ImportSummary } from '@shared/config-export'
import { t } from '@shared/i18n'
import { PROFILE_KINDS, type ProfileKind } from '@shared/profiles'
import { PERMISSION_LEVELS } from '@shared/agent'
import { PRICED_KINDS } from '@shared/pricing'
import { redact, redactArgs } from '@shared/redact'
import { AppError } from '@shared/errors'
import type { Db } from './db/database'
import type { SettingsService } from './settings'
import type { ProfilesService } from './profiles'
import type { AgentDefinitionsService } from './agent-definitions'
import type { McpHub } from '../mcp/hub'
import type { MetricsService } from '../metrics/metrics'

export interface DataDeps {
  db: Db
  settings: SettingsService
  profiles: ProfilesService
  agents: AgentDefinitionsService
  mcp: Pick<McpHub, 'list' | 'create'>
  metrics: Pick<MetricsService, 'prices' | 'savePrice'>
  activeSessionIds: () => string[]
  now?: () => number
}

/** Export and import of the configuration (no secrets), and purging the history. */
export class DataService {
  constructor(private readonly deps: DataDeps) {}

  exportConfig(): ConfigExport {
    const { settings, profiles, agents, mcp, metrics } = this.deps
    const { general, ...rest } = settings.getAll()
    const { recentWorkspaces: _recent, ...portableGeneral } = general
    const profileList = profiles.list()
    const nameOf = new Map(profileList.map((p) => [p.id, p.name]))
    return {
      format: CONFIG_FORMAT,
      version: 1,
      exportedAt: this.deps.now?.() ?? Date.now(),
      settings: { ...rest, general: portableGeneral },
      profiles: profileList.map((p) => ({
        kind: p.kind,
        name: p.name,
        label: p.label,
        color: p.color,
        auth: p.auth,
        defaultModel: p.defaultModel,
        baseUrl: p.baseUrl
      })),
      mcpServers: mcp.list().map((s) => ({
        name: s.name,
        transport: s.transport,
        command: s.command,
        args: redactArgs(s.args),
        url: redact(s.url),
        envKeys: s.envKeys,
        headerKeys: s.headerKeys
      })),
      agents: agents.list().map((a) => ({
        name: a.name,
        profileName: nameOf.get(a.profileId) ?? '',
        model: a.model,
        systemPrompt: a.systemPrompt,
        permissionLevel: a.permissionLevel,
        mcpTools: a.mcpTools
      })),
      prices: metrics
        .prices()
        .filter((p) => p.source === 'user')
        .map((p) => ({ kind: p.kind, modelPrefix: p.modelPrefix, inputPerMTok: p.inputPerMTok, outputPerMTok: p.outputPerMTok }))
    }
  }

  /**
   * Adds what the file has and this installation lacks (matched by name), and replaces the
   * settings. Accounts with an API key are skipped: the key is not in the file.
   */
  async importConfig(raw: unknown): Promise<ImportSummary> {
    const parsed = configExportSchema.safeParse(raw)
    if (!parsed.success) throw new AppError('invalid_request', t('This file is not an Atelier configuration export.'))
    const doc = parsed.data
    const { settings, profiles, agents, mcp, metrics } = this.deps
    const summary: ImportSummary = { settings: true, profiles: 0, mcpServers: 0, agents: 0, prices: 0, skipped: [] }
    settings.importAll(doc.settings)

    for (const p of doc.profiles) {
      if (profiles.list().some((x) => x.name === p.name)) continue
      if (!(PROFILE_KINDS as readonly string[]).includes(p.kind)) {
        summary.skipped.push(t('Account {name}: {kind} is not supported.', { name: p.name, kind: p.kind }))
        continue
      }
      if (p.auth === 'api-key') {
        summary.skipped.push(t('Account {name}: add it again with its API key.', { name: p.name }))
        continue
      }
      try {
        profiles.create({
          kind: p.kind as ProfileKind,
          name: p.name,
          label: p.label,
          color: p.color as never,
          auth: p.auth as never,
          defaultModel: p.defaultModel,
          baseUrl: p.baseUrl
        })
        summary.profiles++
      } catch (err) {
        summary.skipped.push(t('Account {name}: {reason}', { name: p.name, reason: (err as Error).message }))
      }
    }

    for (const s of doc.mcpServers) {
      if (mcp.list().some((x) => x.name === s.name)) continue
      // Values are not in the file: the server is added disabled, with empty values to fill in.
      const blank = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, '']))
      try {
        await mcp.create(
          s.transport === 'stdio'
            ? { transport: 'stdio', name: s.name, command: s.command, args: s.args, env: blank(s.envKeys), enabled: false }
            : { transport: 'http', name: s.name, url: s.url, headers: blank(s.headerKeys), enabled: false }
        )
        summary.mcpServers++
      } catch (err) {
        summary.skipped.push(t('MCP server {name}: {reason}', { name: s.name, reason: (err as Error).message }))
      }
    }

    const profileByName = new Map(profiles.list().map((p) => [p.name, p.id]))
    for (const a of doc.agents) {
      if (agents.list().some((x) => x.name === a.name)) continue
      const profileId = profileByName.get(a.profileName)
      if (!profileId || !(PERMISSION_LEVELS as readonly string[]).includes(a.permissionLevel)) {
        summary.skipped.push(t('Agent {name}: its account {account} is missing.', { name: a.name, account: a.profileName }))
        continue
      }
      agents.create({
        name: a.name,
        profileId,
        model: a.model,
        systemPrompt: a.systemPrompt,
        permissionLevel: a.permissionLevel as never,
        mcpTools: a.mcpTools
      })
      summary.agents++
    }

    for (const p of doc.prices) {
      if (!(PRICED_KINDS as readonly string[]).includes(p.kind)) continue
      try {
        metrics.savePrice({ kind: p.kind as never, modelPrefix: p.modelPrefix, inputPerMTok: p.inputPerMTok, outputPerMTok: p.outputPerMTok })
        summary.prices++
      } catch {
        // The same prefix already has a price here: keep it.
      }
    }
    return summary
  }

  /** Deletes every past session, transcript and usage record. Running sessions are kept. */
  purgeHistory(): { sessions: number } {
    const keep = this.deps.activeSessionIds()
    const marks = keep.map(() => '?').join(', ')
    const not = (col: string) => (keep.length ? `WHERE ${col} NOT IN (${marks})` : '')
    let sessions = 0
    this.deps.db.transaction(() => {
      sessions = this.deps.db.prepare(`DELETE FROM sessions ${not('id')}`).run(...keep).changes
      for (const table of ['session_events', 'usage_events', 'rate_limit_events', 'session_limit_usage']) {
        this.deps.db.prepare(`DELETE FROM ${table} ${not('session_id')}`).run(...keep)
      }
      this.deps.db.prepare('DELETE FROM limit_snapshots').run()
    })()
    return { sessions }
  }
}
