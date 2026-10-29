import { t } from '@shared/i18n'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PermissionLevel } from '@shared/agent'
import type { ConnectionResult, ModelOption } from '@shared/profiles'
import type { AgentMcpServer } from '../../mcp/hub'
import { withoutAccountVars } from '../claude-code/runtime'
import type { SpawnPty } from '../cli/pty-process'
import { stripAnsi } from './stream'
import { describeAgyFailure } from './translate'

/**
 * Environment for agy. HOME (USERPROFILE on Windows) points at the profile's folder, so the
 * settings and MCP config Atelier writes there apply to Atelier's runs only and the user's own
 * ~/.gemini stays untouched. The sign-in itself is in the OS credential store, per OS user.
 */
export function buildAgyEnv(base: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const env = withoutAccountVars(base)
  env['HOME'] = home
  if (platform === 'win32') env['USERPROFILE'] = home
  // Plain output: no colors, no terminal status reports.
  env['NO_COLOR'] = '1'
  env['AGY_CLI_OSC7501'] = 'off'
  return env
}

/**
 * Antigravity cannot ask anyone in headless mode: a tool that needs approval is refused.
 * So each level becomes rules (Deny > Ask > Allow; "ask" means refused here):
 * - validate-all: read only. No edits, commands, browsing or MCP tools.
 * - files-auto: edits inside the folder (Antigravity's default); commands are refused.
 * - autonomous: edits and commands inside the folder, the agent's MCP tools; git push refused.
 */
export function agyPermissions(level: PermissionLevel, mcpTools: string[]): { allow: string[]; deny: string[]; ask: string[] } {
  const protect = ['write_file(.git/)']
  switch (level) {
    case 'validate-all':
      return { allow: [], deny: ['write_file(*)', 'command(*)', 'execute_url(*)', 'mcp(*)', ...protect], ask: [] }
    case 'files-auto':
      return { allow: [], deny: ['command(*)', 'execute_url(*)', 'mcp(*)', ...protect], ask: [] }
    case 'autonomous':
      return {
        allow: ['command(*)', ...mcpTools.map((t) => `mcp(${t})`)],
        deny: ['command(git push)', 'command(regex:git .*push.*)', ...protect],
        ask: []
      }
  }
}

/** `server/tool` names for Antigravity's rules, from Atelier's `mcp__server__tool`. */
export function agyMcpToolNames(servers: AgentMcpServer[]): string[] {
  return servers.flatMap((s) => s.tools.map((t) => `${s.slug}/${t}`))
}

/** Antigravity's `mcp_config.json`, with only the agent's servers and tools. */
export function agyMcpConfig(servers: AgentMcpServer[]): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {}
  for (const s of servers) {
    mcpServers[s.slug] =
      s.transport === 'stdio'
        ? { command: s.command, args: s.args, env: s.env, enabledTools: s.tools }
        : { serverUrl: s.url, headers: s.headers, enabledTools: s.tools }
  }
  return { mcpServers }
}

export interface AgyConfig {
  level: PermissionLevel
  servers: AgentMcpServer[]
}

/** Paths under the profile's home that agy reads (antigravity.google/docs: permissions, mcp). */
export function agyPaths(home: string) {
  return {
    settings: join(home, '.gemini', 'antigravity-cli', 'settings.json'),
    mcp: join(home, '.gemini', 'config', 'mcp_config.json')
  }
}

/**
 * Writes the rules and MCP servers of one session into the profile's home before agy starts.
 * Other settings in the file (a model picked in the sign-in terminal, say) are kept.
 */
export function writeAgyConfig(home: string, config: AgyConfig): void {
  const paths = agyPaths(home)
  let settings: Record<string, unknown> = {}
  if (existsSync(paths.settings)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(paths.settings, 'utf8').replace(/^\uFEFF/, ''))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>
    } catch {
      // unreadable: start over
    }
  }
  settings['permissions'] = agyPermissions(config.level, agyMcpToolNames(config.servers))
  mkdirSync(join(paths.settings, '..'), { recursive: true })
  writeFileSync(paths.settings, JSON.stringify(settings, null, 2))
  mkdirSync(join(paths.mcp, '..'), { recursive: true })
  writeFileSync(paths.mcp, JSON.stringify(agyMcpConfig(config.servers), null, 2))
}

/** Arguments for one headless turn (antigravity.google/docs/cli/headless). */
export function agyArgs(prompt: string, opts: { model: string; conversationId: string | null }): string[] {
  return [
    '-p',
    // A prompt starting with "-" would read as a flag.
    prompt.startsWith('-') ? ` ${prompt}` : prompt,
    '--output-format',
    'stream-json',
    ...(opts.model ? ['--model', opts.model] : []),
    ...(opts.conversationId ? ['--conversation', opts.conversationId] : [])
  ]
}

/** Runs agy with some arguments in a pty and returns its exit code and plain-text output. */
export function runAgy(
  spawn: SpawnPty,
  target: { binary: string; env: Record<string, string>; cwd: string },
  args: string[],
  timeoutMs = 60_000
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = ''
    const proc = spawn({ file: target.binary, args, env: target.env, cwd: target.cwd })
    const timer = setTimeout(() => {
      proc.kill()
      resolve({ code: null, output: stripAnsi(output) })
    }, timeoutMs)
    proc.onData((d) => (output += d))
    proc.onExit((code) => {
      clearTimeout(timer)
      resolve({ code, output: stripAnsi(output).replace(/\r/g, '') })
    })
  })
}

/** Model ids from `agy models`, whose exact layout is not documented: the first token of each line that looks like an id. */
export function parseAgyModels(output: string): ModelOption[] {
  const seen = new Set<string>()
  const out: ModelOption[] = []
  for (const raw of output.split('\n')) {
    const token = raw.trim().replace(/^[*•>-]\s*/, '').split(/\s+/)[0] ?? ''
    if (!/^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)+$/i.test(token) || seen.has(token)) continue
    seen.add(token)
    out.push({ value: token, displayName: token, description: raw.trim().slice(token.length).trim() })
  }
  return out
}

/** "Test connection" for Antigravity: the CLI starts, is signed in, and lists its models. No prompt is sent. */
export async function testAntigravityConnection(
  run: (args: string[]) => Promise<{ code: number | null; output: string }>
): Promise<ConnectionResult> {
  const result: ConnectionResult = {
    ok: false,
    status: 'Not signed in',
    detail: null,
    email: null,
    organization: null,
    subscriptionType: null,
    models: [],
    checkedAt: Date.now()
  }
  let models: { code: number | null; output: string }
  try {
    models = await run(['models'])
  } catch (err) {
    result.status = t('Not connected')
    result.detail = t('Antigravity did not start: {message}', { message: (err as Error).message })
    return result
  }
  const text = models.output.trim()
  if (models.code !== 0) {
    const last = text.split('\n').filter(Boolean).at(-1) ?? ''
    if (/not signed in/.test(describeAgyFailure(last))) {
      result.detail = t('Open the sign-in terminal and log in with your Google account.')
      return result
    }
    result.status = t('Not connected')
    result.detail = models.code === null ? t('Antigravity did not answer in time.') : last || t('agy exited with code {code}.', { code: models.code })
    return result
  }
  result.ok = true
  result.status = t('Signed in')
  result.models = parseAgyModels(text)
  return result
}
