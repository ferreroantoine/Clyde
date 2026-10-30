import { t } from '@shared/i18n'
import { createHash } from 'node:crypto'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { AppError } from '@shared/errors'
import { mcpServerInputSchema, qualifiedToolName, slugify, type McpServer, type McpServerInput, type McpServerUpdate, type McpStatus } from '@shared/mcp'
import type { McpProbe } from '@shared/mcp-catalog'
import type { ToolSpec } from '../agents/api/chat'
import { clip, type ToolOutput } from '../agents/api/tools'
import { mcpImages } from '../agents/media'
import type { Logger } from '../logger'
import type { McpServerRecord, McpStore } from './store'

/** One MCP server as an agent's CLI should load it, limited to the agent's tools. */
export type AgentMcpServer = { slug: string; tools: string[] } & (
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { transport: 'http'; url: string; headers: Record<string, string> }
)

const CALL_TIMEOUT_MS = 10 * 60_000
const CONNECT_TIMEOUT_MS = 30_000

interface RemoteTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** What the hub needs from an MCP connection; the real one wraps the SDK client. */
export interface McpConnection {
  listTools(): Promise<RemoteTool[]>
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutput>
  close(): Promise<void>
  onClose(listener: (error: Error | null) => void): void
  onToolsChanged(listener: () => void): void
}

export type ConnectFn = (server: McpServerRecord) => Promise<McpConnection>

interface State {
  status: McpStatus
  error: string | null
  tools: RemoteTool[]
  connection: McpConnection | null
  /** Bumped on every (re)connect so late events from an old connection are ignored. */
  generation: number
}

/** MCP content blocks as text for the model and the tool card. */
export function contentText(content: unknown): string {
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content)
  return content
    .map((block: { type?: string; text?: string; resource?: { uri?: string; text?: string }; mimeType?: string }) => {
      if (block.type === 'text') return block.text ?? ''
      if (block.type === 'resource') return block.resource?.text ?? `[resource ${block.resource?.uri ?? ''}]`
      if (block.type === 'image' || block.type === 'audio') return `[${block.type} ${block.mimeType ?? ''}]`
      if (block.type === 'resource_link') return `[link ${(block as { uri?: string }).uri ?? ''}]`
      return JSON.stringify(block)
    })
    .join('\n')
}

/**
 * Proxy and certificate settings the SDK's minimal environment leaves out: without them, npx
 * and uvx cannot download a server behind a corporate proxy.
 */
export function networkEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string' && /^(https?_proxy|no_proxy|all_proxy|node_extra_ca_certs|ssl_cert_file|requests_ca_bundle)$/i.test(e[0]))
  )
}

/** The SDK client over stdio, or streamable HTTP with an SSE fallback for older servers. */
export const connectWithSdk: ConnectFn = async (server) => {
  const open = async (transport: Transport) => {
    const client = new Client({ name: 'clyde', version: '0.1.0' })
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS })
    return client
  }
  let client: Client
  if (server.transport === 'stdio') {
    client = await open(
      new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: { ...getDefaultEnvironment(), ...networkEnv(process.env), ...server.env },
        stderr: 'ignore'
      })
    )
  } else {
    const url = new URL(server.url)
    const requestInit = { headers: server.headers }
    try {
      client = await open(new StreamableHTTPClientTransport(url, { requestInit }))
    } catch (streamable) {
      try {
        client = await open(new SSEClientTransport(url, { requestInit }))
      } catch {
        throw streamable
      }
    }
  }
  return {
    async listTools() {
      const tools: RemoteTool[] = []
      let cursor: string | undefined
      do {
        const page = await client.listTools(cursor ? { cursor } : {})
        for (const t of page.tools) {
          tools.push({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> })
        }
        cursor = page.nextCursor
      } while (cursor)
      return tools
    },
    async callTool(name, args, signal) {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: CALL_TIMEOUT_MS,
        resetTimeoutOnProgress: true
      })
      const text = 'content' in result ? contentText(result.content) : JSON.stringify(result)
      const structured = 'structuredContent' in result && result.structuredContent ? JSON.stringify(result.structuredContent) : ''
      const images = 'content' in result && Array.isArray(result.content) ? mcpImages(result.content) : []
      return { content: clip(text || structured || '(no output)'), isError: result.isError === true, ...(images.length ? { images } : {}) }
    },
    close: () => client.close(),
    onClose(listener) {
      client.onclose = () => listener(null)
      client.onerror = (err) => listener(err)
    },
    onToolsChanged(listener) {
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => listener())
    }
  }
}

/** Size of a tool definition as models receive it: name, description and input schema. */
export function definitionChars(tool: { name: string; description: string; inputSchema?: Record<string, unknown> }): number {
  return JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema ?? {} }).length
}

/**
 * On Windows, `npx`, `uvx` and friends are .cmd scripts that CLIs (Claude Code, Codex,
 * Antigravity) cannot start without a shell; they run through `cmd /c`. Clyde's own client
 * finds them by itself (cross-spawn).
 */
export function cliCommand(command: string, args: string[], platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'win32' && /^(npx|npm|pnpm|pnpx|yarn|bunx|uvx|uv)$/i.test(command)) return { command: 'cmd', args: ['/c', command, ...args] }
  return { command, args }
}

/** OpenAI caps function names at 64 characters; long MCP names get a short stable hash. */
export function apiToolName(qualified: string): string {
  if (qualified.length <= 64) return qualified
  return `${qualified.slice(0, 55)}_${createHash('sha1').update(qualified).digest('hex').slice(0, 8)}`
}

/**
 * Keeps one connection per enabled MCP server, tracks its status and tools, and runs tool
 * calls for API agents. Claude Code sessions get the same servers as config and run them.
 */
export class McpHub {
  private readonly states = new Map<string, State>()

  constructor(
    private readonly store: McpStore,
    private readonly opts: { onChanged: (servers: McpServer[]) => void; connect?: ConnectFn; log: Logger; platform?: NodeJS.Platform }
  ) {}

  private platform(): NodeJS.Platform {
    return this.opts.platform ?? process.platform
  }

  list(): McpServer[] {
    return this.store.list().map((record) => {
      const state = this.states.get(record.id)
      return {
        id: record.id,
        name: record.name,
        slug: record.slug,
        transport: record.transport,
        command: record.command,
        args: record.args,
        url: record.url,
        envKeys: Object.keys(record.env),
        headerKeys: Object.keys(record.headers),
        enabled: record.enabled,
        presetId: record.presetId,
        status: record.enabled ? (state?.status ?? 'connecting') : 'disabled',
        error: record.enabled ? (state?.error ?? null) : null,
        tools: (record.enabled && state?.status === 'connected' ? state.tools : []).map((t) => ({
          name: t.name,
          qualifiedName: qualifiedToolName(record.slug, t.name),
          description: t.description,
          chars: definitionChars(t)
        }))
      }
    })
  }

  /** Connects every enabled server; call once at startup. */
  start(): void {
    for (const record of this.store.list()) if (record.enabled) void this.connect(record.id)
  }

  /** Starts a server from its config without saving it, lists its tools, and stops it. */
  async probe(input: McpServerInput): Promise<McpProbe> {
    const data = mcpServerInputSchema.parse(input)
    const record: McpServerRecord = {
      id: 'probe',
      name: data.name,
      slug: slugify(data.name),
      transport: data.transport,
      command: data.transport === 'stdio' ? data.command : '',
      args: data.transport === 'stdio' ? data.args : [],
      url: data.transport === 'http' ? data.url : '',
      env: data.transport === 'stdio' ? data.env : {},
      headers: data.transport === 'http' ? data.headers : {},
      enabled: true,
      presetId: null,
      createdAt: Date.now()
    }
    let connection: McpConnection | null = null
    try {
      connection = await (this.opts.connect ?? connectWithSdk)(record)
      const tools = await connection.listTools()
      return { ok: true, error: null, tools: tools.map((t) => ({ name: t.name, description: t.description, chars: definitionChars(t) })) }
    } catch (err) {
      return { ok: false, error: (err as Error).message, tools: [] }
    } finally {
      await connection?.close().catch(() => undefined)
    }
  }

  create(input: McpServerInput, presetId: string | null = null): McpServer[] {
    const record = this.store.create(input, presetId)
    if (record.enabled) void this.connect(record.id)
    this.changed()
    return this.list()
  }

  update(input: McpServerUpdate): McpServer[] {
    const record = this.store.update(input)
    void this.disconnect(record.id)
    if (record.enabled) void this.connect(record.id)
    this.changed()
    return this.list()
  }

  async delete(id: string): Promise<void> {
    this.store.get(id)
    await this.disconnect(id)
    this.states.delete(id)
    this.store.delete(id)
    this.changed()
  }

  async reconnect(id: string): Promise<void> {
    const record = this.store.get(id)
    if (!record.enabled) throw new AppError('invalid_request', t('Enable the server first'))
    await this.disconnect(id)
    await this.connect(id)
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.states.keys()].map((id) => this.disconnect(id)))
  }

  /** Tool specs for an API agent, limited to its allow-list and to servers that are connected. */
  toolSpecs(allowed: ReadonlySet<string>): Array<ToolSpec & { qualifiedName: string }> {
    const out: Array<ToolSpec & { qualifiedName: string }> = []
    for (const record of this.store.list()) {
      const state = this.states.get(record.id)
      if (!record.enabled || state?.status !== 'connected') continue
      for (const tool of state.tools) {
        const qualified = qualifiedToolName(record.slug, tool.name)
        if (!allowed.has(qualified)) continue
        out.push({
          name: apiToolName(qualified),
          qualifiedName: qualified,
          description: tool.description || `${tool.name} from ${record.name}`,
          inputSchema: tool.inputSchema
        })
      }
    }
    return out
  }

  async callTool(qualified: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutput> {
    for (const record of this.store.list()) {
      const prefix = `mcp__${record.slug}__`
      if (!qualified.startsWith(prefix)) continue
      const state = this.states.get(record.id)
      if (!state?.connection || state.status !== 'connected') {
        return { content: `The MCP server "${record.name}" is not connected`, isError: true }
      }
      try {
        return await state.connection.callTool(qualified.slice(prefix.length), args, signal)
      } catch (err) {
        return { content: `MCP error: ${(err as Error).message}`, isError: true }
      }
    }
    return { content: `No MCP server provides ${qualified}`, isError: true }
  }

  /**
   * Server configs for a Claude Code session: only servers with an allowed tool, plus the
   * names of their other tools to hide with `disallowedTools`.
   */
  claudeCodeConfig(allowed: ReadonlySet<string>): { servers: Record<string, McpServerConfig>; disallowed: string[] } {
    const servers: Record<string, McpServerConfig> = {}
    const disallowed: string[] = []
    for (const record of this.store.list()) {
      if (!record.enabled) continue
      const prefix = `mcp__${record.slug}__`
      const state = this.states.get(record.id)
      const known = (state?.tools ?? []).map((t) => qualifiedToolName(record.slug, t.name))
      if (![...allowed].some((name) => name.startsWith(prefix))) continue
      servers[record.slug] =
        record.transport === 'stdio'
          ? { type: 'stdio', ...cliCommand(record.command, record.args, this.platform()), env: record.env }
          : { type: 'http', url: record.url, headers: record.headers }
      disallowed.push(...known.filter((name) => !allowed.has(name)))
    }
    return { servers, disallowed }
  }

  /**
   * The servers an agent may use, with the raw names of its allowed tools, for CLIs that take
   * their own MCP config (Codex, Antigravity). Each provider writes it in its own format.
   */
  agentServers(allowed: ReadonlySet<string>): AgentMcpServer[] {
    const out: AgentMcpServer[] = []
    for (const record of this.store.list()) {
      if (!record.enabled) continue
      const prefix = `mcp__${record.slug}__`
      const tools = [...allowed].filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length))
      if (tools.length === 0) continue
      out.push(
        record.transport === 'stdio'
          ? { slug: record.slug, transport: 'stdio', ...cliCommand(record.command, record.args, this.platform()), env: record.env, tools }
          : { slug: record.slug, transport: 'http', url: record.url, headers: record.headers, tools }
      )
    }
    return out
  }

  private state(id: string): State {
    let state = this.states.get(id)
    if (!state) {
      state = { status: 'connecting', error: null, tools: [], connection: null, generation: 0 }
      this.states.set(id, state)
    }
    return state
  }

  private async connect(id: string): Promise<void> {
    const record = this.store.get(id)
    const state = this.state(id)
    const generation = ++state.generation
    Object.assign(state, { status: 'connecting', error: null, tools: [], connection: null })
    this.changed()
    try {
      const connection = await (this.opts.connect ?? connectWithSdk)(record)
      if (generation !== state.generation) {
        await connection.close().catch(() => undefined)
        return
      }
      state.connection = connection
      connection.onClose((error) => {
        if (generation !== state.generation) return
        Object.assign(state, {
          status: 'error',
          error: error ? error.message : t('The server closed the connection'),
          connection: null,
          tools: []
        })
        this.changed()
      })
      connection.onToolsChanged(() => void this.refreshTools(id, generation))
      state.tools = await connection.listTools()
      state.status = 'connected'
      this.opts.log.info(`mcp ${record.slug}: connected, ${state.tools.length} tools`)
    } catch (err) {
      if (generation !== state.generation) return
      Object.assign(state, { status: 'error', error: (err as Error).message, connection: null, tools: [] })
      this.opts.log.warn(`mcp ${record.slug}: could not connect`, err)
    }
    this.changed()
  }

  private async refreshTools(id: string, generation: number): Promise<void> {
    const state = this.states.get(id)
    if (!state?.connection || state.generation !== generation) return
    try {
      state.tools = await state.connection.listTools()
      this.changed()
    } catch {
      // keep the previous list
    }
  }

  private async disconnect(id: string): Promise<void> {
    const state = this.states.get(id)
    if (!state) return
    state.generation++
    const connection = state.connection
    Object.assign(state, { connection: null, tools: [], status: 'connecting', error: null })
    await connection?.close().catch(() => undefined)
  }

  private changed(): void {
    this.opts.onChanged(this.list())
  }
}
