import { t } from '@shared/i18n'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpServerInput } from '@shared/mcp'

/** Where Claude Desktop keeps its config on each platform. */
export function claudeDesktopConfigPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') return join(env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  return join(env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'Claude', 'claude_desktop_config.json')
}

export interface ParsedConfig {
  servers: Array<{ name: string; input: McpServerInput }>
  skipped: Array<{ name: string; reason: string }>
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, String(v)])
  )
}

/**
 * Reads the `mcpServers` map of claude_desktop_config.json (the same shape as Claude Code's
 * .mcp.json): `{command, args, env}` for stdio servers and `{type, url, headers}` for remote ones.
 */
export function parseClaudeDesktopConfig(text: string): ParsedConfig {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(t('This file is not valid JSON: {message}', { message: (err as Error).message }), { cause: err })
  }
  if (!isRecord(json) || !isRecord(json['mcpServers'])) {
    throw new Error(t('This file has no "mcpServers" section.'))
  }
  const out: ParsedConfig = { servers: [], skipped: [] }
  for (const [name, raw] of Object.entries(json['mcpServers'])) {
    if (!isRecord(raw)) {
      out.skipped.push({ name, reason: t('Not an object') })
      continue
    }
    if (raw['disabled'] === true) {
      out.skipped.push({ name, reason: t('Disabled in the file') })
      continue
    }
    const type = typeof raw['type'] === 'string' ? raw['type'] : undefined
    if (typeof raw['command'] === 'string' && raw['command'].trim() && (!type || type === 'stdio')) {
      out.servers.push({
        name,
        input: {
          transport: 'stdio',
          name,
          command: raw['command'],
          args: Array.isArray(raw['args']) ? raw['args'].map(String) : [],
          env: stringMap(raw['env'])
        }
      })
    } else if (typeof raw['url'] === 'string' && /^https?:\/\//i.test(raw['url'])) {
      // Streamable HTTP and the older SSE transport share one entry; the hub tries both.
      out.servers.push({ name, input: { transport: 'http', name, url: raw['url'], headers: stringMap(raw['headers']) } })
    } else {
      out.skipped.push({ name, reason: t('Neither a command nor an http(s) URL') })
    }
  }
  return out
}
