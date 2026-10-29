import type { AgentEventEnvelope } from '@shared/agent'

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor', 'run_command'])
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

const crlf = (text: string) => text.replace(/\r?\n/g, '\r\n')

/**
 * Turns an agent's shell tool calls into the text of its read-only terminal: the command,
 * its output (streamed for API agents, at the end for Claude Code) and a marker on failure.
 */
export class AgentTerminalFeed {
  private readonly calls = new Map<string, { streamed: boolean }>()

  constructor(private readonly write: (sessionId: string, data: string) => void) {}

  feed({ sessionId, event }: AgentEventEnvelope): void {
    switch (event.type) {
      case 'tool_call': {
        if (!SHELL_TOOLS.has(event.name)) return
        this.calls.set(event.toolUseId, { streamed: false })
        const command = typeof event.input['command'] === 'string' ? event.input['command'] : ''
        this.write(sessionId, `${CYAN}$${RESET} ${crlf(command)}\r\n`)
        return
      }
      case 'tool_output': {
        const call = this.calls.get(event.toolUseId)
        if (!call) return
        call.streamed = true
        this.write(sessionId, crlf(event.chunk))
        return
      }
      case 'tool_result': {
        const call = this.calls.get(event.toolUseId)
        if (!call) return
        this.calls.delete(event.toolUseId)
        if (!call.streamed) this.write(sessionId, `${crlf(event.content.trimEnd())}\r\n`)
        this.write(sessionId, event.isError ? `${RED}✗ failed${RESET}\r\n\r\n` : `${DIM}─${RESET}\r\n\r\n`)
        return
      }
      case 'permission_denied': {
        if (!this.calls.delete(event.toolUseId)) return
        this.write(sessionId, `${DIM}refused: ${event.reason}${RESET}\r\n\r\n`)
        return
      }
    }
  }
}
