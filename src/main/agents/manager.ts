import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  agentStartSchema,
  type AgentEvent,
  type AgentEventEnvelope,
  type AgentQuestion,
  type AgentSessionInfo,
  type AgentStart,
  type AgentStatus,
  type ApprovalDecision
} from '@shared/agent'
import { AppError } from '@shared/errors'
import { isApiKind, type Profile } from '@shared/profiles'
import type { ProfilesService } from '../services/profiles'
import { ApprovalBroker, type QuestionAnswers } from '../permissions/broker'
import { decide, type PermissionDecision, type ToolRequest } from '../permissions/engine'
import type { McpHub } from '../mcp/hub'
import { ClaudeCodeSession, type QueryFn } from './claude-code/provider'
import { buildProfileEnv, resolveClaudeBinary, withoutAccountVars } from './claude-code/runtime'
import type { ChatAdapter, ImageInput } from './api/chat'
import { describeApiError, type ApiTarget } from './api/clients'
import { ApiSession } from './api/loop'
import { BASE_TOOLS, BaseToolExecutor, defaultShell, toEngineRequest } from './api/tools'
import type { Logger } from '../logger'
import type { LimitReading } from '@shared/limits'
import { t } from '@shared/i18n'
import { CodexSession } from './codex/session'
import { buildCodexEnv, codexMcpServers } from './codex/runtime'
import { spawnCli, type SpawnCli } from './cli/process'
import { resolveAntigravityBinary, resolveCodexBinary } from './cli/resolve'
import { spawnPty, type SpawnPty } from './cli/pty-process'
import { AntigravitySession } from './antigravity/session'
import { buildAgyEnv } from './antigravity/runtime'

/** Default cap on agents running at once (plan: "agent CPU guard"). */
export const MAX_ACTIVE_SESSIONS = 4

export interface AgentManagerDeps {
  profiles: ProfilesService
  /** Settings › Agents: how many agents may run at once, and the model when none is set. */
  maxParallel?: () => number
  defaultModel?: () => string
  mcp: Pick<McpHub, 'toolSpecs' | 'callTool' | 'claudeCodeConfig' | 'agentServers'>
  claudeCodePath: () => string
  /** Codex executable from Settings; empty means the one on PATH. */
  codexPath?: () => string
  /** Finds the Codex executable; swapped in tests. */
  resolveCodex?: (override: string) => string
  /** Starts CLIs with piped stdio (Codex). */
  spawnCli?: SpawnCli
  /** Antigravity executable from Settings; empty means agy from PATH. */
  antigravityPath?: () => string
  resolveAntigravity?: (override: string) => string
  /** Starts CLIs in a pseudo-terminal (Antigravity). */
  spawnPty?: SpawnPty
  /** Detected CLI versions, for the session header. */
  cliVersion?: (kind: 'codex' | 'antigravity') => string
  workspaceRoot: () => string | null
  query: () => Promise<QueryFn>
  createAdapter: (target: ApiTarget) => ChatAdapter
  /** Whether PowerShell 7 is installed, for API agents' run_command on Windows. */
  hasPwsh: () => boolean
  onEvent: (envelope: AgentEventEnvelope) => void
  /** Plan limits a session read (subscription accounts). */
  onLimits?: (profileId: string, sessionId: string, readings: LimitReading[]) => void
  onSession: (info: AgentSessionInfo) => void
  /** The memory for API agents' system prompt (Settings › Memory & context). */
  memory?: () => string
  /** History size past which API agents summarize older turns (0: never). */
  summarizeAt?: () => number
  /** Writes a summary: the internal model, else the session's own account (`fallback`). */
  summarize?: (transcript: string, fallback: { profileId: string; model: string } | undefined, signal?: AbortSignal) => Promise<string>
  /** A session's transcript as text, for "New session with a summary". */
  transcript?: (sessionId: string) => string
  clientApp: string
  baseEnv?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  log: Logger
}

/** What the manager drives: a Claude Code session or Clyde's own loop. */
interface AgentSession {
  start(): Promise<void>
  send(text: string, images?: ImageInput[]): void
  interrupt(): Promise<void>
  stop(): void
  /** The provider's own way to shrink the context; Antigravity has none Clyde can drive. */
  compact?(): Promise<void>
}

interface Entry {
  info: AgentSessionInfo
  session: AgentSession | null
  seq: number
  /** What started it, to start it again with a summary. */
  request: AgentStart
}

const ENDED: AgentStatus[] = ['stopped', 'error']

/** The API agents' system prompt. The user's own text, if any, follows it. */
export function apiSystemPrompt(cwd: string, platform: NodeJS.Platform, extra: string): string {
  const os = platform === 'win32' ? 'Windows (commands run in PowerShell)' : platform === 'darwin' ? 'macOS' : 'Linux'
  return [
    `You are a coding agent working inside Clyde, in the folder ${cwd} on ${os}.`,
    'Use the tools to read and change files and to run commands. Paths are relative to that folder.',
    'Read a file before editing it, and prefer edit_file for small changes. Keep replies short and say what you changed.',
    'Some tool calls wait for the user to approve them. When one is denied, follow the user’s message instead of retrying.',
    extra.trim()
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Tools a chat session's API loop gets: reading the attachments in its folder. */
const CHAT_API_TOOLS = new Set(['read_file', 'list_files'])

/** Claude Code tools turned off in chat; the permission hook refuses them anyway. */
const CHAT_CLAUDE_DISALLOWED = ['Bash', 'PowerShell', 'Monitor', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'KillShell']

const CHAT_REFUSAL = () => t('The chat cannot change files or run commands. Use “Continue in the project” for that.')

/** API agents' system prompt in the chat view. */
export function chatSystemPrompt(extra: string): string {
  return [
    'You are a helpful assistant in the chat of Clyde, a desktop IDE. Answer in Markdown: headings, lists, tables and fenced code blocks with a language render well; LaTeX math goes between $…$ or $$…$$.',
    'Files the user attaches are in your working folder; read them with your tools when the message mentions them.',
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
    const max = this.deps.maxParallel?.() ?? MAX_ACTIVE_SESSIONS
    if (active >= max) {
      throw new AppError('not_allowed', t('{count} agents are already running. Stop one first, or raise the limit in Settings › Agents.', { count: max }))
    }
    const profile = this.deps.profiles.requireUsable(req.profileId)
    const cwd = req.cwd ?? this.deps.workspaceRoot()
    if (!cwd) throw new AppError('no_workspace', t('Open a folder first: the agent works inside it.'))
    if (!existsSync(cwd)) throw new AppError('not_found', t('The folder {cwd} does not exist', { cwd }))
    const apiKey = profile.auth === 'api-key' ? this.deps.profiles.apiKey(profile.id) : null
    if (profile.auth === 'api-key' && !apiKey) throw new AppError('invalid_request', t('This profile has no API key'))

    const id = `as-${randomUUID()}`
    const platform = this.deps.platform ?? process.platform
    const allowed = new Set(req.mcpTools)
    const info: AgentSessionInfo = {
      id,
      profileId: profile.id,
      kind: profile.kind,
      model: req.model || profile.defaultModel || (this.deps.defaultModel?.() ?? ''),
      effort: req.effort,
      permissionLevel: req.permissionLevel,
      cwd,
      mcpTools: req.mcpTools,
      agentId: req.agentId ?? null,
      taskId: req.taskId ?? null,
      chatId: req.chatId ?? null,
      status: 'starting',
      createdAt: Date.now()
    }
    // MCP tools outside the allow-list are refused, whatever the permission level says.
    const chat = !!req.chatId
    const gate = (tool: ToolRequest): PermissionDecision => {
      if (tool.name.startsWith('mcp__') && !allowed.has(tool.name)) {
        return { decision: 'deny', reason: t("{name} is not in this agent's MCP tools", { name: tool.name }) }
      }
      if (!chat) return decide({ level: info.permissionLevel, cwd, platform }, tool)
      // Chat: MCP tools the user switched on run; reads stay in the conversation's folder; nothing else.
      if (tool.name.startsWith('mcp__')) return { decision: 'allow' }
      const verdict = decide({ level: 'validate-all', cwd, platform }, tool)
      return verdict.decision === 'ask' ? { decision: 'deny', reason: CHAT_REFUSAL() } : verdict
    }
    const common = {
      emit: (event: AgentEvent) => this.emit(id, event),
      decide: gate,
      ask: (question: Parameters<ApprovalBroker['ask']>[1], signal: AbortSignal) => this.broker.ask(id, question, signal),
      // The chat never waits for the user: no questions there.
      ...(chat ? {} : { question: (toolUseId: string, questions: AgentQuestion[], signal: AbortSignal) => this.broker.question(id, toolUseId, questions, signal) })
    }

    // CLI agents keep their own system prompt; in chat they get the chat guidance on top of it.
    const cliPrompt = chat ? chatSystemPrompt(req.systemPrompt) : req.systemPrompt
    let session: AgentSession
    if (isApiKind(profile.kind)) {
      session = await this.apiSession(profile, apiKey, info, req.systemPrompt, allowed, platform, common)
    } else if (profile.kind === 'claude-code') {
      session = await this.claudeCodeSession(profile, apiKey, info, cliPrompt, allowed, common, chat ? CHAT_CLAUDE_DISALLOWED : [])
    } else if (profile.kind === 'codex') {
      session = this.codexSession(profile, info, cliPrompt, allowed, platform, common)
    } else {
      this.checkAntigravityConflict(profile.id, info)
      session = this.antigravitySession(profile, info, cliPrompt, allowed, platform, common.emit)
    }

    const entry: Entry = { info, session, seq: 0, request }
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
    common: Pick<ConstructorParameters<typeof ClaudeCodeSession>[1], 'emit' | 'decide' | 'ask' | 'question'>,
    disallowed: string[] = []
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
        effort: info.effort,
        appendSystemPrompt: systemPrompt,
        mcpServers: mcp.servers,
        disallowedTools: [...mcp.disallowed, ...disallowed]
      },
      {
        ...common,
        query,
        log: (line) => log.debug(`[${info.id}] ${line}`),
        ...(profile.auth === 'subscription' && this.deps.onLimits
          ? { onLimits: (readings: LimitReading[]) => this.deps.onLimits?.(profile.id, info.id, readings) }
          : {})
      }
    )
  }

  private codexSession(
    profile: Profile,
    info: AgentSessionInfo,
    systemPrompt: string,
    allowed: ReadonlySet<string>,
    platform: NodeJS.Platform,
    common: Pick<ConstructorParameters<typeof CodexSession>[1], 'emit' | 'decide' | 'ask'>
  ): AgentSession {
    const binary = (this.deps.resolveCodex ?? resolveCodexBinary)(this.deps.codexPath?.() ?? '')
    const log = this.deps.log
    return new CodexSession(
      {
        binary,
        env: buildCodexEnv(this.deps.baseEnv ?? process.env, this.deps.profiles.configDir(profile.id)),
        cwd: info.cwd,
        model: info.model,
        effort: info.effort,
        permissionLevel: info.permissionLevel,
        platform,
        instructions: systemPrompt,
        mcpServers: codexMcpServers(this.deps.mcp.agentServers(allowed)),
        clientVersion: this.deps.clientApp.split('/')[1] ?? '0.0.0'
      },
      {
        ...common,
        spawn: this.deps.spawnCli ?? spawnCli,
        log: (line) => log.debug(`[${info.id}] ${line}`),
        onLimits: (readings) => this.deps.onLimits?.(profile.id, info.id, readings)
      }
    )
  }

  /**
   * Antigravity reads its rules and MCP config from the profile's home when each run starts.
   * Two sessions of one account with different rules would overwrite each other's, so a second
   * one must match the first.
   */
  private checkAntigravityConflict(profileId: string, info: AgentSessionInfo): void {
    const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
    const other = this.list().find(
      (s) =>
        s.profileId === profileId &&
        !ENDED.includes(s.status) &&
        (s.permissionLevel !== info.permissionLevel || !same(s.mcpTools, info.mcpTools))
    )
    if (other) {
      throw new AppError(
        'not_allowed',
        t('Another Antigravity session of this account runs with a different permission level or MCP tools. Stop it first, or use the same settings.')
      )
    }
  }

  private antigravitySession(
    profile: Profile,
    info: AgentSessionInfo,
    systemPrompt: string,
    allowed: ReadonlySet<string>,
    platform: NodeJS.Platform,
    emit: (event: AgentEvent) => void
  ): AgentSession {
    const binary = (this.deps.resolveAntigravity ?? resolveAntigravityBinary)(this.deps.antigravityPath?.() ?? '')
    const home = this.deps.profiles.configDir(profile.id)
    const log = this.deps.log
    return new AntigravitySession(
      {
        binary,
        env: buildAgyEnv(this.deps.baseEnv ?? process.env, home, platform),
        home,
        cwd: info.cwd,
        model: info.model,
        effort: info.effort,
        permissionLevel: info.permissionLevel,
        instructions: systemPrompt,
        servers: this.deps.mcp.agentServers(allowed),
        cliVersion: this.deps.cliVersion?.('antigravity') ?? ''
      },
      { spawn: this.deps.spawnPty ?? spawnPty, emit, log: (line) => log.debug(`[${info.id}] ${line}`) }
    )
  }

  private async apiSession(
    profile: Profile,
    apiKey: string | null,
    info: AgentSessionInfo,
    systemPrompt: string,
    allowed: ReadonlySet<string>,
    platform: NodeJS.Platform,
    common: Pick<ConstructorParameters<typeof ApiSession>[1], 'emit' | 'decide' | 'ask' | 'question'>
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
      if (!info.model) throw new AppError('invalid_request', t('This account lists no model. Choose one by name.'))
    }
    const mcpTools = this.deps.mcp.toolSpecs(allowed)
    const qualified = new Map(mcpTools.map((t) => [t.name, t.qualifiedName]))
    const executor = new BaseToolExecutor(
      info.cwd,
      defaultShell(platform, this.deps.hasPwsh()),
      withoutAccountVars(this.deps.baseEnv ?? process.env)
    )
    const chat = info.chatId !== null
    const summarize = this.deps.summarize
    return new ApiSession(
      {
        model: info.model,
        effort: info.effort,
        memory: this.deps.memory?.() ?? '',
        summarizeAt: this.deps.summarizeAt?.() ?? 0,
        system: chat ? chatSystemPrompt(systemPrompt) : apiSystemPrompt(info.cwd, platform, systemPrompt),
        tools: [...(chat ? BASE_TOOLS.filter((tool) => CHAT_API_TOOLS.has(tool.name)) : BASE_TOOLS), ...mcpTools.map(({ qualifiedName: _q, ...spec }) => spec)]
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
        describeError: (err) => describeApiError(err, target),
        ...(summarize ? { summarize: (text: string, signal: AbortSignal) => summarize(text, { profileId: profile.id, model: info.model }, signal) } : {})
      }
    )
  }

  /** The provider's own compaction (Claude Code `/compact`, Codex compact, a summary for API agents). */
  async compact(sessionId: string): Promise<void> {
    const entry = this.require(sessionId)
    if (ENDED.includes(entry.info.status)) throw new AppError('not_allowed', t('This session has ended. Start a new one.'))
    if (!entry.session?.compact) throw new AppError('not_allowed', t('This agent cannot compact its conversation; start a new session with a summary instead.'))
    await entry.session.compact()
  }

  /**
   * Stops this session and starts the same agent again with a summary of it as background. The summary comes from the internal model; without one, the end of the
   * transcript is passed as is.
   */
  async continueWithSummary(sessionId: string): Promise<AgentSessionInfo> {
    const entry = this.require(sessionId)
    const transcript = this.deps.transcript?.(sessionId) ?? ''
    let summary = ''
    if (this.deps.summarize && transcript.trim()) {
      const fallback = isApiKind(entry.info.kind) ? { profileId: entry.info.profileId, model: entry.info.model } : undefined
      summary = await this.deps.summarize(transcript.slice(-60_000), fallback).catch(() => '')
    }
    const context = summary
      ? `Summary of the previous session with this user, to continue from:\n${summary}`
      : transcript
        ? `End of the previous session with this user, to continue from:\n${transcript.slice(-12_000)}`
        : ''
    const request = agentStartSchema.parse(entry.request)
    // Stopped first, so the new one does not count against the limit of agents running at once.
    if (!ENDED.includes(entry.info.status)) this.stop(sessionId)
    return this.start({ ...request, systemPrompt: [request.systemPrompt, context].filter(Boolean).join('\n\n') })
  }

  /** `images` reach API models directly; CLI agents read attachments from their folder instead. */
  send(sessionId: string, text: string, images: ImageInput[] = []): void {
    const entry = this.require(sessionId)
    if (ENDED.includes(entry.info.status)) throw new AppError('not_allowed', t('This session has ended. Start a new one.'))
    this.emit(sessionId, { type: 'user', id: randomUUID(), text })
    this.setStatus(sessionId, 'running')
    if (images.length) entry.session?.send(text, images)
    else entry.session?.send(text)
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

  answerQuestion(sessionId: string, requestId: string, answers: QuestionAnswers): void {
    this.require(sessionId)
    this.broker.answerQuestion(sessionId, requestId, answers)
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
    if (!entry) throw new AppError('not_found', t('This agent session no longer exists'))
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
      case 'question_request':
        this.setStatus(sessionId, 'awaiting-approval')
        break
      case 'approval_resolved':
      case 'question_resolved':
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
