import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  agentStartSchema,
  type AgentEvent,
  type AgentEventEnvelope,
  type AgentSessionInfo,
  type AgentStart,
  type AgentStatus,
  type ApprovalDecision
} from '@shared/agent'
import { AppError } from '@shared/errors'
import { isApiKind, type Profile } from '@shared/profiles'
import type { ProfilesService } from '../services/profiles'
import { ApprovalBroker } from '../permissions/broker'
import { decide, type ToolRequest } from '../permissions/engine'
import type { McpHub } from '../mcp/hub'
import { ClaudeCodeSession, type QueryFn } from './claude-code/provider'
import { buildProfileEnv, resolveClaudeBinary, withoutAccountVars } from './claude-code/runtime'
import type { ChatAdapter } from './api/chat'
import { describeApiError, type ApiTarget } from './api/clients'
import { ApiSession } from './api/loop'
import { BASE_TOOLS, BaseToolExecutor, defaultShell, toEngineRequest } from './api/tools'
import type { Logger } from '../logger'

/** Default cap on agents running at once (plan: "agent CPU guard"). */
export const MAX_ACTIVE_SESSIONS = 4

export interface AgentManagerDeps {
  profiles: ProfilesService
  mcp: Pick<McpHub, 'toolSpecs' | 'callTool' | 'claudeCodeConfig'>
  claudeCodePath: () => string
  workspaceRoot: () => string | null
  query: () => Promise<QueryFn>
  createAdapter: (target: ApiTarget) => ChatAdapter
  /** Whether PowerShell 7 is installed, for API agents' run_command on Windows. */
  hasPwsh: () => boolean
  onEvent: (envelope: AgentEventEnvelope) => void
  onSession: (info: AgentSessionInfo) => void
  clientApp: string
  baseEnv?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  log: Logger
}

/** What the manager drives: a Claude Code session or Atelier's own loop. */
interface AgentSession {
  start(): Promise<void>
  send(text: string): void
  interrupt(): Promise<void>
  stop(): void
}

interface Entry {
  info: AgentSessionInfo
  session: AgentSession | null
  seq: number
}

const ENDED: AgentStatus[] = ['stopped', 'error']

/** The API agents' system prompt. The user's own text, if any, follows it. */
export function apiSystemPrompt(cwd: string, platform: NodeJS.Platform, extra: string): string {
  const os = platform === 'win32' ? 'Windows (commands run in PowerShell)' : platform === 'darwin' ? 'macOS' : 'Linux'
  return [
    `You are a coding agent working inside Atelier, in the folder ${cwd} on ${os}.`,
    'Use the tools to read and change files and to run commands. Paths are relative to that folder.',
    'Read a file before editing it, and prefer edit_file for small changes. Keep replies short and say what you changed.',
    'Some tool calls wait for the user to approve them. When one is denied, follow the user’s message instead of retrying.',
    extra.trim()
  ]
    .filter(Boolean)
    .join('\n\n')
}

export class AgentManager {
  private readonly sessions = new Map<string, Entry>()
  private readonly broker = new ApprovalBroker((sessionId, event) => this.emit(sessionId, event))

  constructor(private readonly deps: AgentManagerDeps) {}

  list(): AgentSessionInfo[] {
    return [...this.sessions.values()].map((e) => e.info)
  }

  get(sessionId: string): AgentSessionInfo | null {
    return this.sessions.get(sessionId)?.info ?? null
  }

  async start(request: AgentStart): Promise<AgentSessionInfo> {
    const req = agentStartSchema.parse(request)
    const active = this.list().filter((s) => !ENDED.includes(s.status)).length
    if (active >= MAX_ACTIVE_SESSIONS) {
      throw new AppError('not_allowed', `${MAX_ACTIVE_SESSIONS} agents are already running. Stop one first.`)
    }
    const profile = this.deps.profiles.requireUsable(req.profileId)
    const cwd = req.cwd ?? this.deps.workspaceRoot()
    if (!cwd) throw new AppError('no_workspace', 'Open a folder first: the agent works inside it.')
    if (!existsSync(cwd)) throw new AppError('not_found', `The folder ${cwd} does not exist`)
    const apiKey = profile.auth === 'api-key' ? this.deps.profiles.apiKey(profile.id) : null
    if (profile.auth === 'api-key' && !apiKey) throw new AppError('invalid_request', 'This profile has no API key')

    const id = `as-${randomUUID()}`
    const platform = this.deps.platform ?? process.platform
    const allowed = new Set(req.mcpTools)
    const info: AgentSessionInfo = {
      id,
      profileId: profile.id,
      kind: profile.kind,
      model: req.model || profile.defaultModel,
      permissionLevel: req.permissionLevel,
      cwd,
      mcpTools: req.mcpTools,
      agentId: req.agentId ?? null,
      taskId: req.taskId ?? null,
      status: 'starting',
      createdAt: Date.now()
    }
    // MCP tools outside the allow-list are refused, whatever the permission level says.
    const gate = (tool: ToolRequest) =>
      tool.name.startsWith('mcp__') && !allowed.has(tool.name)
        ? { decision: 'deny' as const, reason: `${tool.name} is not in this agent's MCP tools` }
        : decide({ level: info.permissionLevel, cwd, platform }, tool)
    const common = {
      emit: (event: AgentEvent) => this.emit(id, event),
      decide: gate,
      ask: (question: Parameters<ApprovalBroker['ask']>[1], signal: AbortSignal) => this.broker.ask(id, question, signal)
    }

    const session: AgentSession = isApiKind(profile.kind)
      ? await this.apiSession(profile, apiKey, info, req.systemPrompt, allowed, platform, common)
      : await this.claudeCodeSession(profile, apiKey, info, req.systemPrompt, allowed, common)

    const entry: Entry = { info, session, seq: 0 }
    this.sessions.set(id, entry)
    this.deps.onSession(info)
    const log = this.deps.log
    session.start().then(
      () => this.setStatus(id, 'stopped'),
      (err) => {
        log.warn(`session ${id} ended with an error`, err)
        this.setStatus(id, 'error')
      }
    )
    this.setStatus(id, 'idle')
    return entry.info
  }

  private async claudeCodeSession(
    profile: Profile,
    apiKey: string | null,
    info: AgentSessionInfo,
    systemPrompt: string,
    allowed: ReadonlySet<string>,
    common: Pick<ConstructorParameters<typeof ClaudeCodeSession>[1], 'emit' | 'decide' | 'ask'>
  ): Promise<AgentSession> {
    const binary = resolveClaudeBinary(this.deps.claudeCodePath())
    const env = buildProfileEnv(
      this.deps.baseEnv ?? process.env,
      { configDir: this.deps.profiles.configDir(profile.id), apiKey },
      this.deps.clientApp
    )
    const mcp = this.deps.mcp.claudeCodeConfig(allowed)
    const query = await this.deps.query()
    const log = this.deps.log
    return new ClaudeCodeSession(
      {
        binary,
        env,
        cwd: info.cwd,
        model: info.model,
        appendSystemPrompt: systemPrompt,
        mcpServers: mcp.servers,
        disallowedTools: mcp.disallowed
      },
      { ...common, query, log: (line) => log.debug(`[${info.id}] ${line}`) }
    )
  }

  private async apiSession(
    profile: Profile,
    apiKey: string | null,
    info: AgentSessionInfo,
    systemPrompt: string,
    allowed: ReadonlySet<string>,
    platform: NodeJS.Platform,
    common: Pick<ConstructorParameters<typeof ApiSession>[1], 'emit' | 'decide' | 'ask'>
  ): Promise<AgentSession> {
    if (!isApiKind(profile.kind)) throw new Error('not an API profile')
    const target: ApiTarget = { kind: profile.kind, apiKey, baseUrl: profile.baseUrl }
    const adapter = this.deps.createAdapter(target)
    if (!info.model) {
      // No model chosen: take the provider's first chat model, as Claude Code does with its default.
      const models = await adapter.listModels().catch((err) => {
        throw new AppError('agent_error', describeApiError(err, target))
      })
      info.model = models[0]?.value ?? ''
      if (!info.model) throw new AppError('invalid_request', 'This account lists no model. Choose one by name.')
    }
    const mcpTools = this.deps.mcp.toolSpecs(allowed)
    const qualified = new Map(mcpTools.map((t) => [t.name, t.qualifiedName]))
    const executor = new BaseToolExecutor(
      info.cwd,
      defaultShell(platform, this.deps.hasPwsh()),
      withoutAccountVars(this.deps.baseEnv ?? process.env)
    )
    return new ApiSession(
      {
        model: info.model,
        system: apiSystemPrompt(info.cwd, platform, systemPrompt),
        tools: [...BASE_TOOLS, ...mcpTools.map(({ qualifiedName: _q, ...spec }) => spec)]
      },
      {
        ...common,
        adapter,
        toEngine: (call) => {
          const mcpName = qualified.get(call.name)
          return mcpName ? { name: mcpName, input: call.input } : toEngineRequest(call.name, call.input, platform)
        },
        execute: (call, signal, onOutput) => {
          const mcpName = qualified.get(call.name)
          return mcpName ? this.deps.mcp.callTool(mcpName, call.input, signal) : executor.run(call.name, call.input, signal, onOutput)
        },
        describeError: (err) => describeApiError(err, target)
      }
    )
  }

  send(sessionId: string, text: string): void {
    const entry = this.require(sessionId)
    if (ENDED.includes(entry.info.status)) throw new AppError('not_allowed', 'This session has ended. Start a new one.')
    this.emit(sessionId, { type: 'user', id: randomUUID(), text })
    this.setStatus(sessionId, 'running')
    entry.session?.send(text)
  }

  async interrupt(sessionId: string): Promise<void> {
    const entry = this.require(sessionId)
    this.broker.cancelSession(sessionId, 'The user interrupted the agent')
    await entry.session?.interrupt()
  }

  stop(sessionId: string): void {
    const entry = this.require(sessionId)
    this.broker.forgetSession(sessionId)
    entry.session?.stop()
    this.setStatus(sessionId, 'stopped')
  }

  answer(sessionId: string, requestId: string, decision: ApprovalDecision, message?: string): void {
    this.require(sessionId)
    this.broker.answer(sessionId, requestId, decision, message)
  }

  stopAll(): void {
    for (const id of this.sessions.keys()) {
      try {
        this.stop(id)
      } catch {
        // already gone
      }
    }
  }

  private require(sessionId: string): Entry {
    const entry = this.sessions.get(sessionId)
    if (!entry) throw new AppError('not_found', 'This agent session no longer exists')
    return entry
  }

  private setStatus(sessionId: string, status: AgentStatus): void {
    const entry = this.sessions.get(sessionId)
    if (!entry || entry.info.status === status) return
    // A stopped session never comes back to life when its process exits later.
    if (entry.info.status === 'stopped') return
    entry.info = { ...entry.info, status }
    this.deps.onSession(entry.info)
    this.emit(sessionId, { type: 'status', status })
  }

  private emit(sessionId: string, event: AgentEvent): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.seq++
    this.deps.onEvent({ sessionId, seq: entry.seq, event })
    switch (event.type) {
      case 'init':
        if (event.model && event.model !== entry.info.model) {
          entry.info = { ...entry.info, model: event.model }
          this.deps.onSession(entry.info)
        }
        break
      case 'approval_request':
        this.setStatus(sessionId, 'awaiting-approval')
        break
      case 'approval_resolved':
        if (!this.broker.hasPending(sessionId) && entry.info.status === 'awaiting-approval') {
          this.setStatus(sessionId, 'running')
        }
        break
      case 'turn_end':
        this.setStatus(sessionId, 'idle')
        break
    }
  }
}
