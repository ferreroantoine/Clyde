import type { ContextBreakdown } from '@shared/agent'
import type { ChatMessage, ToolSpec } from '../agents/api/chat'

/**
 * Keeping the API loop's context small. Pure functions over the vendor-neutral history, so
 * the rules are tested on their own and the same for every provider.
 */

/** Tool results larger than this are cut in the history once the model has seen them. */
export const TOOL_RESULT_KEEP = 4_000
const HEAD = 1_500
const TAIL = 1_500

export const READ_TOOL_OUTPUT = 'read_tool_output'

/** Lets the model get back a tool output that was cut from the history. */
export const READ_TOOL_OUTPUT_SPEC: ToolSpec = {
  name: READ_TOOL_OUTPUT,
  description:
    'Read the full output of an earlier tool call that was shortened in the conversation history. Use the id given in the "[… cut …]" note. Returns up to 30000 characters from offset.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The tool call id from the note.' },
      offset: { type: 'number', description: 'Character offset to start from (default 0).' }
    },
    required: ['id']
  }
}

export function cutNote(id: string, cut: number): string {
  return `\n… [${cut} characters cut from the history to save context. The full output is still available: call ${READ_TOOL_OUTPUT} with id "${id}".] …\n`
}

/**
 * Shortens large tool results of every tool message but the last (the model has already read
 * those), keeping their beginning and end. Returns the new history and the full outputs that
 * were shortened, by tool call id.
 */
export function compactToolResults(history: readonly ChatMessage[], keep = TOOL_RESULT_KEEP): { history: ChatMessage[]; cut: Map<string, string> } {
  const cut = new Map<string, string>()
  const lastTool = history.findLastIndex((m) => m.role === 'tool')
  const out = history.map((m, i) => {
    if (m.role !== 'tool' || i === lastTool) return m
    let changed = false
    const results = m.results.map((r) => {
      if (r.content.length <= keep || r.content.includes(`call ${READ_TOOL_OUTPUT} with id`)) return r
      changed = true
      cut.set(r.toolCallId, r.content)
      const removed = r.content.length - HEAD - TAIL
      return { ...r, content: r.content.slice(0, HEAD) + cutNote(r.toolCallId, removed) + r.content.slice(-TAIL) }
    })
    return changed ? { ...m, results } : m
  })
  return { history: out, cut }
}

/** Where each turn starts: a user message with text (tool results are not turns). */
function turnStarts(history: readonly ChatMessage[]): number[] {
  return history.flatMap((m, i) => (m.role === 'user' ? [i] : []))
}

/**
 * Splits the history for a rolling summary: everything before the last `keepTurns` turns,
 * and those turns, untouched. Null when there is nothing old enough to summarize.
 */
export function splitForSummary(history: readonly ChatMessage[], keepTurns = 2): { older: ChatMessage[]; recent: ChatMessage[] } | null {
  const starts = turnStarts(history)
  if (starts.length <= keepTurns) return null
  const cut = starts[starts.length - keepTurns] as number
  if (cut === 0) return null
  return { older: history.slice(0, cut), recent: history.slice(cut) }
}

/** The history after a summary: the summary as context, then the recent turns as they were. */
export function withSummary(summary: string, recent: readonly ChatMessage[]): ChatMessage[] {
  return [
    { role: 'user', text: `[Summary of the earlier part of this conversation, written to save context]\n${summary.trim()}` },
    { role: 'assistant', text: 'Noted. I will continue from this summary.', toolCalls: [] },
    ...recent
  ]
}

/** The older part of a conversation as plain text, for the model that summarizes it. */
export function transcriptText(messages: readonly ChatMessage[], maxResult = 1_500): string {
  return messages
    .map((m) => {
      if (m.role === 'user') return `User: ${m.text}`
      if (m.role === 'assistant') {
        const calls = m.toolCalls.map((c) => `[called ${c.name} ${JSON.stringify(c.input).slice(0, 300)}]`).join(' ')
        return `Assistant: ${[m.text, calls].filter(Boolean).join(' ')}`
      }
      return m.results.map((r) => `Tool ${r.name}${r.isError ? ' (error)' : ''}: ${r.content.slice(0, maxResult)}`).join('\n')
    })
    .join('\n\n')
}

export const SUMMARY_SYSTEM = [
  'You summarize the earlier part of a working session between a user and a coding agent, so the agent can continue without it.',
  'Keep: the goal, decisions and their reasons, files and commands that matter, what was done, what failed, open questions and next steps.',
  'Drop: chatter and full tool outputs. Use short bullet points. Write in the language of the conversation.'
].join(' ')

export const TITLE_SYSTEM =
  'Give this conversation a short title: at most six words, in the language of the conversation, no quotes, no final period. Reply with the title only.'

/** Rough size of a history in characters, as the API would receive it. */
export function historyChars(history: readonly ChatMessage[]): { history: number; toolResults: number } {
  let rest = 0
  let toolResults = 0
  for (const m of history) {
    if (m.role === 'tool') toolResults += JSON.stringify(m.results).length
    else rest += JSON.stringify(m).length
  }
  return { history: rest, toolResults }
}

/** Estimated tokens of a whole request: about four characters per token. */
export function estimateRequestTokens(system: string, tools: readonly ToolSpec[], history: readonly ChatMessage[]): number {
  const h = historyChars(history)
  return Math.ceil((system.length + JSON.stringify(tools).length + h.history + h.toolResults) / 4)
}

/**
 * Splits the reported input of one request between its parts in proportion to their sizes,
 * so the parts add up to what the provider counted.
 */
export function breakdown(
  parts: { system: string; memory: string; tools: readonly ToolSpec[]; history: readonly ChatMessage[] },
  inputTokens: number,
  outputTokens: number
): ContextBreakdown {
  const h = historyChars(parts.history)
  const sizes = { system: parts.system.length, memory: parts.memory.length, tools: JSON.stringify(parts.tools).length, history: h.history, toolResults: h.toolResults }
  const total = Object.values(sizes).reduce((a, b) => a + b, 0) || 1
  const scale = (n: number) => Math.round((n / total) * inputTokens)
  return {
    system: scale(sizes.system),
    memory: scale(sizes.memory),
    tools: scale(sizes.tools),
    history: scale(sizes.history),
    toolResults: scale(sizes.toolResults),
    output: outputTokens
  }
}
