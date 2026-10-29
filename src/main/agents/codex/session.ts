import type { AgentEvent, PermissionLevel } from '@shared/agent'
import type { PermissionDecision, ToolRequest } from '../../permissions/engine'
import type { ApprovalOutcome, ApprovalQuestion } from '../../permissions/broker'
import type { CliProcess, SpawnCli } from '../cli/process'
import { RpcConnection, RpcRequestError } from './rpc'
import type {
  AskForApproval,
  CommandApprovalParams,
  FileChangeApprovalParams,
  GetAccountRateLimitsResponse,
  InitializeResponse,
  Notifications,
  PermissionsApprovalParams,
  SandboxMode,
  ThreadStartParams,
  ThreadStartResponse,
  TurnStartResponse
} from './protocol'
import { CodexTranslator, shellToolName, versionFromUserAgent } from './translate'
import { parseCodexRateLimits, type LimitReading } from '@shared/limits'

/** Notifications Atelier never reads; opting out keeps the pipe quiet. */
const QUIET = [
  'thread/status/changed',
  'thread/readState/changed',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta',
  'item/plan/delta',
  'turn/diff/updated',
  'turn/plan/updated',
  'rawResponseItem/completed',
  'rawResponse/completed',
  'remoteControl/status/changed',
  'mcpServer/event/stream/notification',
  'fs/changed'
]

/**
 * How each permission level maps onto Codex. Codex enforces its sandbox itself and asks
 * Atelier (an approval request) before anything outside it; Atelier's permission engine
 * then decides, and asks the user when the level says so.
 * - validate-all: read-only sandbox, every non-trivial command and every edit asks.
 * - files-auto: edits inside the folder run; commands ask.
 * - autonomous: edits and commands inside the folder run; escalations still come to the engine.
 */
export function codexPolicy(level: PermissionLevel): { sandbox: SandboxMode; approvalPolicy: AskForApproval } {
  switch (level) {
    case 'validate-all':
      return { sandbox: 'read-only', approvalPolicy: 'untrusted' }
    case 'files-auto':
      return { sandbox: 'workspace-write', approvalPolicy: 'untrusted' }
    case 'autonomous':
      return { sandbox: 'workspace-write', approvalPolicy: 'on-request' }
  }
}

export interface CodexSessionConfig {
  binary: string
  env: Record<string, string>
  cwd: string
  model: string
  permissionLevel: PermissionLevel
  platform: NodeJS.Platform
  /** Added to Codex's instructions as developer instructions. */
  instructions: string
  /** `mcp_servers` table for Codex's config: only the agent's servers and tools. */
  mcpServers: Record<string, unknown>
  clientVersion: string
}

export interface CodexSessionDeps {
  spawn: SpawnCli
  emit: (event: AgentEvent) => void
  decide: (tool: ToolRequest) => PermissionDecision
  ask: (question: ApprovalQuestion, signal: AbortSignal) => Promise<ApprovalOutcome>
  /** Plan limits, read after each turn and whenever Codex says they changed. */
  onLimits?: (readings: LimitReading[]) => void
  log?: (line: string) => void
}

/** One Codex thread over `codex app-server`, which runs for the whole session. */
export class CodexSession {
  private proc: CliProcess | null = null
  private rpc: RpcConnection | null = null
  private threadId: string | null = null
  /** The running turn: its id once `turn/start` answered, 'starting' before. */
  private turn: string | null = null
  private readonly queue: string[] = []
  private stopped = false
  private readonly abort = new AbortController()
  private readonly translator: CodexTranslator

  constructor(
    private readonly cfg: CodexSessionConfig,
    private readonly deps: CodexSessionDeps
  ) {
    this.translator = new CodexTranslator(cfg.platform)
  }

  async start(): Promise<void> {
    const log = this.deps.log ?? (() => undefined)
    const proc = this.deps.spawn({ file: this.cfg.binary, args: ['app-server'], env: this.cfg.env, cwd: this.cfg.cwd })
    this.proc = proc
    const rpc = new RpcConnection(proc.transport, log)
    this.rpc = rpc
    rpc.onNotification((method, params) => this.notification(method, params))
    rpc.onRequest((method, params) => this.serverRequest(method, params))
    try {
      const init = await rpc.request<InitializeResponse>('initialize', {
        clientInfo: { name: 'atelier', title: 'Atelier', version: this.cfg.clientVersion },
        capabilities: { experimentalApi: false, requestAttestation: false, optOutNotificationMethods: QUIET }
      })
      rpc.notify('initialized')
      const params: ThreadStartParams = {
        cwd: this.cfg.cwd,
        ...codexPolicy(this.cfg.permissionLevel),
        ...(this.cfg.model ? { model: this.cfg.model } : {}),
        ...(this.cfg.instructions.trim() ? { developerInstructions: this.cfg.instructions } : {}),
        ...(Object.keys(this.cfg.mcpServers).length ? { config: { mcp_servers: this.cfg.mcpServers } } : {})
      }
      const thread = await rpc.request<ThreadStartResponse>('thread/start', params)
      this.threadId = thread.thread.id
      this.deps.emit({
        type: 'init',
        model: thread.model,
        cliVersion: versionFromUserAgent(init.userAgent),
        cwd: thread.cwd,
        tools: []
      })
      this.pump()
    } catch (err) {
      if (!this.stopped) {
        const detail = proc.stderrTail().split('\n').filter(Boolean).at(-1)
        this.deps.emit({ type: 'error', message: `Codex did not start: ${(err as Error).message}${detail ? ` (${detail})` : ''}` })
      }
      proc.kill()
      throw err
    }
    const code = await proc.exited
    rpc.close(new Error('Codex exited'))
    if (!this.stopped && code !== 0) {
      const detail = proc.stderrTail().split('\n').filter(Boolean).at(-1)
      this.deps.emit({ type: 'error', message: `Codex exited with code ${code ?? 'unknown'}${detail ? `: ${detail}` : ''}` })
      throw new Error(`Codex exited with code ${code}`)
    }
  }

  send(text: string): void {
    if (this.stopped) return
    this.queue.push(text)
    this.pump()
  }

  async interrupt(): Promise<void> {
    const turnId = this.turn
    if (!this.rpc || !this.threadId || !turnId || turnId === 'starting') return
    await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId }).catch(() => undefined)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.abort.abort()
    this.rpc?.close(new Error('The session was stopped'))
    this.proc?.kill()
  }

  /** Starts the next queued message once the thread exists and no turn runs. */
  private pump(): void {
    const rpc = this.rpc
    if (this.stopped || !rpc || !this.threadId || this.turn || this.queue.length === 0) return
    const text = this.queue.shift() as string
    this.turn = 'starting'
    rpc
      .request<TurnStartResponse>('turn/start', { threadId: this.threadId, input: [{ type: 'text', text, text_elements: [] }] })
      .then((res) => {
        // turn/completed may already have cleared it.
        if (this.turn === 'starting') this.turn = res.turn.id
      })
      .catch((err: Error) => {
        if (this.stopped) return
        this.turn = null
        const message = err instanceof RpcRequestError ? err.error.message : err.message
        this.deps.emit({ type: 'error', message: `Codex refused the message: ${message}` })
        this.deps.emit({
          type: 'turn_end',
          isError: true,
          subtype: 'error_during_execution',
          errors: [message],
          costUsd: null,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0
        })
        this.pump()
      })
  }

  private notification(method: string, params: unknown): void {
    if (method === 'turn/started') {
      const id = (params as Notifications['turn/started']).turn.id
      if (this.turn === 'starting' || this.turn === null) this.turn = id
    }
    // Updates are sparse; a full read gives every window and bucket.
    if (method === 'account/rateLimits/updated') this.readLimits()
    if (method === 'configWarning' || method === 'warning') {
      this.deps.log?.(`codex ${method}: ${JSON.stringify(params).slice(0, 500)}`)
    }
    for (const event of this.translator.translate(method, params)) this.deps.emit(event)
    if (method === 'turn/completed') {
      this.turn = null
      this.readLimits()
      this.pump()
    }
  }

  private limitsReading = false

  private readLimits(): void {
    const rpc = this.rpc
    if (!this.deps.onLimits || !rpc || this.limitsReading || this.stopped) return
    this.limitsReading = true
    rpc
      .request<GetAccountRateLimitsResponse>('account/rateLimits/read')
      .then((res) => {
        const readings = parseCodexRateLimits(res.rateLimits, res.rateLimitsByLimitId)
        if (readings.length) this.deps.onLimits?.(readings)
      })
      .catch((err: Error) => this.deps.log?.(`could not read rate limits: ${err.message}`))
      .finally(() => (this.limitsReading = false))
  }

  private async serverRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const p = params as CommandApprovalParams
        const tool = { name: shellToolName(this.cfg.platform), input: { command: p.command ?? '', ...(p.cwd ? { cwd: p.cwd } : {}) } }
        const allowed = await this.approve(p.itemId, p.turnId, tool, p.reason ?? null)
        return { decision: allowed ? 'accept' : 'decline' }
      }
      case 'item/fileChange/requestApproval': {
        const p = params as FileChangeApprovalParams
        const paths = this.translator.changesOf(p.itemId).map((c) => c.path)
        if (p.grantRoot) paths.push(p.grantRoot)
        const allowed = await this.approveFiles(p.itemId, p.turnId, paths, p.reason ?? null)
        return { decision: allowed ? 'accept' : 'decline' }
      }
      case 'item/permissions/requestApproval': {
        const p = params as PermissionsApprovalParams
        const tool = { name: 'CodexPermissions', input: { cwd: p.cwd, permissions: p.permissions as unknown } }
        const allowed = await this.approve(p.itemId, p.turnId, tool, p.reason ?? 'Codex asks for more access than its sandbox gives')
        const granted: Record<string, unknown> = {}
        if (allowed) {
          if (p.permissions.network) granted['network'] = p.permissions.network
          if (p.permissions.fileSystem) granted['fileSystem'] = p.permissions.fileSystem
        }
        return { permissions: granted, scope: 'turn' }
      }
      case 'item/tool/requestUserInput':
        // Atelier has no UI for the agent's questions yet; an empty answer lets it carry on.
        return { answers: {} }
      case 'mcpServer/elicitation/request':
        return { action: 'decline', content: null, _meta: null }
      case 'applyPatchApproval':
      case 'execCommandApproval':
        return { decision: { denied: { rejection: 'Atelier only answers v2 approval requests.' } } }
      default:
        throw { code: -32601, message: `Atelier does not handle ${method}` }
    }
  }

  /** Runs one tool request through the engine, asking the user when it says so. */
  private async approve(itemId: string, turnId: string, tool: ToolRequest, reason: string | null): Promise<boolean> {
    return this.resolve(itemId, turnId, tool, this.deps.decide(tool), reason)
  }

  /** A file change is allowed only if every path is: one denial denies it, one "ask" asks. */
  private async approveFiles(itemId: string, turnId: string, paths: string[], reason: string | null): Promise<boolean> {
    const decisions = (paths.length ? paths : ['']).map((path) => this.deps.decide({ name: 'Edit', input: { file_path: path } }))
    const decision =
      decisions.find((d) => d.decision === 'deny') ?? decisions.find((d) => d.decision === 'ask') ?? { decision: 'allow' as const }
    const tool = { name: 'Edit', input: { file_path: paths[0] ?? '', paths } }
    return this.resolve(itemId, turnId, tool, decision, reason)
  }

  private async resolve(
    itemId: string,
    turnId: string,
    tool: ToolRequest,
    decision: PermissionDecision,
    codexReason: string | null
  ): Promise<boolean> {
    if (decision.decision === 'allow') return true
    if (decision.decision === 'deny') {
      this.deps.emit({ type: 'permission_denied', toolUseId: itemId, toolName: tool.name, reason: decision.reason })
      return false
    }
    const reason = codexReason ? `${decision.reason}. Codex says: ${codexReason}` : decision.reason
    const outcome = await this.deps.ask({ toolUseId: itemId, toolName: tool.name, input: tool.input, reason }, this.abort.signal)
    if (outcome.behavior === 'allow') return true
    // Codex's decline carries no message; the user's reason goes to the agent as steering input.
    if (outcome.message.trim()) setTimeout(() => void this.steer(turnId, outcome.message), 0)
    return false
  }

  private async steer(turnId: string, message: string): Promise<void> {
    if (!this.rpc || !this.threadId || this.stopped) return
    const text = `The user declined that action: ${message}`
    await this.rpc
      .request('turn/steer', { threadId: this.threadId, expectedTurnId: turnId, input: [{ type: 'text', text, text_elements: [] }] })
      .catch((err: Error) => this.deps.log?.(`could not pass the denial message to Codex: ${err.message}`))
  }
}
