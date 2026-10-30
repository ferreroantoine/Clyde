import { t } from '@shared/i18n'
import type { AgentEvent, PermissionLevel } from '@shared/agent'
import type { AgentMcpServer } from '../../mcp/hub'
import type { PtyProcess, SpawnPty } from '../cli/pty-process'
import { agyArgs, writeAgyConfig } from './runtime'
import { PtyLineReader } from './stream'
import { AgyTranslator, describeAgyFailure } from './translate'

/** The Windows command line is limited to 32 767 characters; the prompt travels in it. */
export const MAX_PROMPT_CHARS = 30_000

const DENIED = /\b(denied|not allowed|requires? (approval|permission)|permission)\b/i

export interface AntigravitySessionConfig {
  binary: string
  env: Record<string, string>
  /** The profile's home folder, where the rules and MCP config are written. */
  home: string
  cwd: string
  model: string
  effort?: string
  permissionLevel: PermissionLevel
  /** Clyde's instructions; agy has no flag for them, so they open the first message. */
  instructions: string
  servers: AgentMcpServer[]
  cliVersion: string
  /** A conversation to continue (`--conversation`); its first message already carried the instructions. */
  conversationId?: string
}

export interface AntigravitySessionDeps {
  spawn: SpawnPty
  emit: (event: AgentEvent) => void
  writeConfig?: typeof writeAgyConfig
  log?: (line: string) => void
}

/**
 * An Antigravity conversation: one `agy -p` run per message, in a pseudo-terminal because agy
 * prints nothing when its output is not a terminal, chained with `--conversation`. agy has no
 * approval channel in headless mode, so the permission level is applied as rules before each run.
 */
export class AntigravitySession {
  private conversationId: string | null = null
  private readonly queue: string[] = []
  private current: PtyProcess | null = null
  private turns = 0
  private reportedModel: string
  private stopped = false
  private interrupted = false
  private resolveEnded: () => void = () => undefined
  private readonly ended = new Promise<void>((r) => (this.resolveEnded = r))

  constructor(
    private readonly cfg: AntigravitySessionConfig,
    private readonly deps: AntigravitySessionDeps
  ) {
    this.reportedModel = cfg.model
    if (cfg.conversationId) {
      this.conversationId = cfg.conversationId
      this.turns = 1
    }
  }

  /** Resolves when the session is stopped; each message starts its own agy run. */
  async start(): Promise<void> {
    this.deps.emit({ type: 'init', model: this.cfg.model, cliVersion: this.cfg.cliVersion, cwd: this.cfg.cwd, tools: [] })
    await this.ended
  }

  send(text: string): void {
    if (this.stopped) return
    this.queue.push(text)
    this.next()
  }

  async interrupt(): Promise<void> {
    if (!this.current) return
    this.interrupted = true
    this.current.write('\x03')
    const proc = this.current
    setTimeout(() => {
      if (this.current === proc) proc.kill()
    }, 2000)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.queue.length = 0
    this.current?.kill()
    this.resolveEnded()
  }

  private next(): void {
    if (this.stopped || this.current || this.queue.length === 0) return
    const text = this.queue.shift() as string
    const first = this.turns === 0
    this.turns++
    const prompt = first && this.cfg.instructions.trim() ? `${this.cfg.instructions.trim()}\n\n---\n\n${text}` : text
    if (prompt.length > MAX_PROMPT_CHARS) {
      this.fail(t('The message is too long for Antigravity ({length} characters, {max} at most).', { length: prompt.length, max: MAX_PROMPT_CHARS }))
      return
    }
    try {
      ;(this.deps.writeConfig ?? writeAgyConfig)(this.cfg.home, { level: this.cfg.permissionLevel, servers: this.cfg.servers })
    } catch (err) {
      this.fail(t("Could not write Antigravity's settings: {message}", { message: (err as Error).message }))
      return
    }
    this.run(prompt)
  }

  private run(prompt: string): void {
    const translator = new AgyTranslator(`t${this.turns}`)
    const reader = new PtyLineReader()
    const notices: string[] = []
    const emitAll = (items: ReturnType<PtyLineReader['push']>) => {
      for (const item of items) {
        if (item.kind === 'event') {
          const e = item.event
          // The model agy picked when none was chosen, for the session header.
          if (e.event === 'init' && e.model && e.model !== this.reportedModel) {
            this.reportedModel = e.model
            this.deps.emit({ type: 'init', model: e.model, cliVersion: this.cfg.cliVersion, cwd: this.cfg.cwd, tools: e.tools ?? [] })
          }
          for (const event of translator.translate(e)) this.deps.emit(event)
          continue
        }
        notices.push(item.line)
        this.deps.log?.(`agy: ${item.line.slice(0, 500)}`)
        if (translator.activeTool && DENIED.test(item.line)) {
          const { id, name } = translator.activeTool
          this.deps.emit({ type: 'permission_denied', toolUseId: id, toolName: name, reason: item.line })
        }
      }
    }
    this.interrupted = false
    const args = agyArgs(prompt, { model: this.cfg.model, ...(this.cfg.effort ? { effort: this.cfg.effort } : {}), conversationId: this.conversationId })
    let proc: PtyProcess
    try {
      proc = this.deps.spawn({ file: this.cfg.binary, args, env: this.cfg.env, cwd: this.cfg.cwd })
    } catch (err) {
      this.fail(t('Antigravity did not start: {message}', { message: (err as Error).message }))
      return
    }
    this.current = proc
    proc.onData((data) => emitAll(reader.push(data)))
    proc.onExit((code) => {
      emitAll(reader.flush())
      this.current = null
      if (translator.conversationId && translator.conversationId !== this.conversationId) {
        this.conversationId = translator.conversationId
        this.deps.emit({ type: 'init', model: this.reportedModel, cliVersion: this.cfg.cliVersion, cwd: this.cfg.cwd, tools: [], resumeId: this.conversationId })
      }
      if (!translator.sawResult && !this.stopped) {
        const last = notices.filter((l) => l.trim()).at(-1) ?? ''
        if (this.interrupted) this.turnEnd('interrupted', [])
        else this.fail(last ? describeAgyFailure(last) : t('Antigravity exited with code {code} without an answer.', { code }))
        return
      }
      this.next()
    })
  }

  private fail(message: string): void {
    this.deps.emit({ type: 'error', message })
    this.turnEnd('error_during_execution', [], true)
  }

  private turnEnd(subtype: string, errors: string[], isError = false): void {
    this.deps.emit({ type: 'turn_end', isError, subtype, errors, costUsd: null, inputTokens: 0, outputTokens: 0, durationMs: 0 })
    this.next()
  }
}
