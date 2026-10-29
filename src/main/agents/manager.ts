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
import type { ProfilesService } from '../services/profiles'
import { ApprovalBroker } from '../permissions/broker'
import { decide } from '../permissions/engine'
import { ClaudeCodeSession, type QueryFn } from './claude-code/provider'
import { buildProfileEnv, resolveClaudeBinary } from './claude-code/runtime'
import type { Logger } from '../logger'

/** Default cap on agents running at once (plan: "agent CPU guard"). */
export const MAX_ACTIVE_SESSIONS = 4

export interface AgentManagerDeps {
  profiles: ProfilesService
  claudeCodePath: () => string
  workspaceRoot: () => string | null
  query: () => Promise<QueryFn>
  onEvent: (envelope: AgentEventEnvelope) => void
  onSession: (info: AgentSessionInfo) => void
  clientApp: string
  baseEnv?: NodeJS.ProcessEnv
  log: Logger
}

interface Entry {
  info: AgentSessionInfo
  session: ClaudeCodeSession | null
  seq: number
}

const ENDED: AgentStatus[] = ['stopped', 'error']

export class AgentManager {
  private readonly sessions = new Map<string, Entry>()
  private readonly broker = new ApprovalBroker((sessionId, event) => this.emit(sessionId, event))

  constructor(private readonly deps: AgentManagerDeps) {}

  list(): AgentSessionInfo[] {
    return [...this.sessions.values()].map((e) => e.info)
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
    const binary = resolveClaudeBinary(this.deps.claudeCodePath())
    const env = buildProfileEnv(
      this.deps.baseEnv ?? process.env,
      { configDir: this.deps.profiles.configDir(profile.id), apiKey },
      this.deps.clientApp
    )

    const id = `as-${randomUUID()}`
    const info: AgentSessionInfo = {
      id,
      profileId: profile.id,
      model: req.model || profile.defaultModel,
      permissionLevel: req.permissionLevel,
      cwd,
      status: 'starting',
      createdAt: Date.now()
    }
    const entry: Entry = { info, session: null, seq: 0 }
    this.sessions.set(id, entry)
    this.deps.onSession(info)

    const query = await this.deps.query()
    const log = this.deps.log
    const session = new ClaudeCodeSession(
      { binary, env, cwd, model: info.model },
      {
        query,
        emit: (event) => this.emit(id, event),
        decide: (tool) => decide({ level: info.permissionLevel, cwd, platform: process.platform }, tool),
        ask: (question, signal) => this.broker.ask(id, question, signal),
        log: (line) => log.debug(`[${id}] ${line}`)
      }
    )
    entry.session = session
    session.start().then(
      () => this.setStatus(id, 'stopped'),
      (err) => {
        log.warn(`session ${id} ended with an error`, err)
        this.setStatus(id, entry.info.status === 'stopped' ? 'stopped' : 'error')
      }
    )
    this.setStatus(id, 'idle')
    return entry.info
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
