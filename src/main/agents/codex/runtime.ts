import type { ConnectionResult, ModelOption } from '@shared/profiles'
import type { AgentMcpServer } from '../../mcp/hub'
import { withoutAccountVars } from '../claude-code/runtime'
import type { SpawnCli } from '../cli/process'
import { RpcConnection, RpcRequestError } from './rpc'
import type { GetAccountResponse, InitializeResponse, ModelListResponse, RateLimitSnapshot } from './protocol'
import { versionFromUserAgent } from './translate'

/** Environment for a Codex process: the app's, minus every account variable, plus the profile's CODEX_HOME. */
export function buildCodexEnv(base: NodeJS.ProcessEnv, codexHome: string): Record<string, string> {
  const env = withoutAccountVars(base)
  env['CODEX_HOME'] = codexHome
  return env
}

/**
 * The agent's MCP servers as a Codex `mcp_servers` table, each limited to the agent's tools
 * with `enabled_tools`. Passed in the thread's config, so nothing is written to disk.
 */
export function codexMcpServers(servers: AgentMcpServer[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const s of servers) {
    out[s.slug] =
      s.transport === 'stdio'
        ? { command: s.command, args: s.args, env: s.env, enabled_tools: s.tools }
        : { url: s.url, http_headers: s.headers, enabled_tools: s.tools }
  }
  return out
}

export interface CodexProbe {
  version: string
  account: GetAccountResponse
  models: ModelOption[]
  rateLimits: RateLimitSnapshot | null
}

/** Starts `codex app-server` for one profile, reads account and models, and stops it. No model call. */
export async function probeCodex(
  spawn: SpawnCli,
  target: { binary: string; env: Record<string, string>; cwd: string; clientVersion: string },
  timeoutMs = 30_000
): Promise<CodexProbe> {
  const proc = spawn({ file: target.binary, args: ['app-server'], env: target.env, cwd: target.cwd })
  const rpc = new RpcConnection(proc.transport)
  const timer = setTimeout(() => rpc.close(new Error('Codex did not answer in time')), timeoutMs)
  try {
    const init = await rpc.request<InitializeResponse>('initialize', {
      clientInfo: { name: 'atelier', title: 'Atelier', version: target.clientVersion },
      capabilities: { experimentalApi: false, requestAttestation: false }
    })
    rpc.notify('initialized')
    const account = await rpc.request<GetAccountResponse>('account/read', {})
    const models = await rpc.request<ModelListResponse>('model/list', {})
    let rateLimits: RateLimitSnapshot | null = null
    if (account.account) {
      rateLimits = await rpc
        .request<{ rateLimits: RateLimitSnapshot }>('account/rateLimits/read')
        .then((r) => r.rateLimits)
        .catch(() => null)
    }
    return {
      version: versionFromUserAgent(init.userAgent),
      account,
      rateLimits,
      models: models.data
        .filter((m) => !m.hidden)
        .map((m) => ({ value: m.model, displayName: m.displayName, description: m.description }))
    }
  } catch (err) {
    if (err instanceof RpcRequestError) throw new Error(`Codex answered ${err.method} with: ${err.message}`, { cause: err })
    const detail = proc.stderrTail().split('\n').filter(Boolean).at(-1)
    throw new Error(detail ? `${(err as Error).message} (${detail})` : (err as Error).message, { cause: err })
  } finally {
    clearTimeout(timer)
    rpc.close(new Error('probe finished'))
    proc.kill()
  }
}

/** "Test connection" for a Codex profile: signed in with a ChatGPT plan, and the models it offers. */
export async function testCodexConnection(
  probe: () => Promise<CodexProbe>
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
  let info: CodexProbe
  try {
    info = await probe()
  } catch (err) {
    result.status = 'Not connected'
    result.detail = `Codex did not start: ${(err as Error).message}`
    return result
  }
  result.models = info.models
  const account = info.account.account
  if (!account) {
    result.detail = 'Open the sign-in terminal and log in with the ChatGPT account this profile should use.'
    return result
  }
  if (account.type !== 'chatgpt') {
    result.status = 'Wrong sign-in'
    result.detail = `Codex is signed in with ${account.type === 'apiKey' ? 'an API key' : account.type}, not a ChatGPT plan. Sign in again with ChatGPT.`
    return result
  }
  const chatgpt = account as { type: 'chatgpt'; email: string | null; planType: string }
  result.ok = true
  result.status = 'Signed in'
  result.email = chatgpt.email
  result.subscriptionType = chatgpt.planType
  return result
}
