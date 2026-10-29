import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@shared/agent'
import { AgentTerminalFeed } from './agent-terminal'

describe('AgentTerminalFeed', () => {
  it('writes shell commands with streamed or final output, and ignores other tools', () => {
    const out: string[] = []
    const feed = new AgentTerminalFeed((id, data) => out.push(`${id}|${data}`))
    const send = (event: AgentEvent) => feed.feed({ sessionId: 's', seq: 1, event })
    send({ type: 'tool_call', toolUseId: 'r', name: 'Read', input: { file_path: 'a' }, parentToolUseId: null })
    send({ type: 'tool_result', toolUseId: 'r', content: 'file', isError: false })
    send({ type: 'tool_call', toolUseId: 'b', name: 'Bash', input: { command: 'ls' }, parentToolUseId: null })
    send({ type: 'tool_result', toolUseId: 'b', content: 'a.ts\nb.ts\n', isError: false })
    send({ type: 'tool_call', toolUseId: 'c', name: 'run_command', input: { command: 'npm test' }, parentToolUseId: null })
    send({ type: 'tool_output', toolUseId: 'c', chunk: 'ok 1\n' })
    send({ type: 'tool_result', toolUseId: 'c', content: 'ok 1\n[exit code 1]', isError: true })
    expect(out.join('')).toBe(
      's|\x1b[36m$\x1b[0m ls\r\n' +
        's|a.ts\r\nb.ts\r\n' +
        's|\x1b[2m─\x1b[0m\r\n\r\n' +
        's|\x1b[36m$\x1b[0m npm test\r\n' +
        's|ok 1\r\n' +
        's|\x1b[31m✗ failed\x1b[0m\r\n\r\n'
    )
  })
})
