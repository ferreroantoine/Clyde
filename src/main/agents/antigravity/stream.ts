/**
 * Reading `agy -p --output-format stream-json` through a pseudo-terminal. The terminal adds
 * escape sequences and CRLF line ends, and can split a long line; this module undoes that and
 * returns the JSON events plus the plain text lines (stderr notices end up there too).
 */

// CSI sequences, OSC sequences (ended by BEL or ST), and other two-character escapes.
// eslint-disable-next-line no-control-regex -- matching terminal control characters is the point
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/** Lines longer than this that never parse are dropped instead of growing forever. */
const MAX_PENDING = 4 * 1024 * 1024
const MAX_PENDING_LINES = 200

export type StreamItem = { kind: 'event'; event: AgyEvent } | { kind: 'text'; line: string }

export interface AgyUsage {
  input_tokens?: number
  output_tokens?: number
  thinking_tokens?: number
  cache_read_tokens?: number
  total_tokens?: number
}

export interface AgyToolInfo {
  name?: string
  parameters?: unknown
  output?: unknown
  error?: { type?: string; message?: string } | null
}

export type AgyEvent =
  | { event: 'init'; cwd?: string; tools?: string[]; permission_mode?: string; model?: string }
  | {
      event: 'step_update'
      conversation_id?: string
      step_index?: number
      state?: 'ACTIVE' | 'DONE' | string
      step_type?: 'user_input' | 'agent_response' | 'tool' | 'checkpoint' | string
      tool_name?: string
      text_delta?: string
      duration_seconds?: number
      usage?: AgyUsage
      tool_info?: AgyToolInfo
    }
  | {
      event: 'result'
      conversation_id?: string
      status?: string
      response?: string
      error?: unknown
      duration_seconds?: number
      num_turns?: number
      usage?: AgyUsage
    }

/**
 * Normalizes one event line. The documented shape nests the payload under a key named
 * after the event (`{"event":"init","init":{…}}`); a flat object is accepted as well.
 */
export function parseAgyEvent(value: unknown): AgyEvent | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const name = obj['event']
  if (name !== 'init' && name !== 'step_update' && name !== 'result') return null
  const nested = obj[name]
  const payload = nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : obj
  return { ...payload, event: name } as AgyEvent
}

export class PtyLineReader {
  private buffer = ''
  /** A line that looked like JSON but did not parse yet: the rest may come on the next line. */
  private pending = ''
  private pendingLines = 0

  /** Feeds raw terminal output; returns the complete items it contained. */
  push(data: string): StreamItem[] {
    this.buffer += data
    const out: StreamItem[] = []
    let index: number
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const raw = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      this.line(stripAnsi(raw).replace(/\r/g, ''), out)
    }
    return out
  }

  /** Whatever is left when the process exits. */
  flush(): StreamItem[] {
    const out: StreamItem[] = []
    if (this.buffer) this.line(stripAnsi(this.buffer).replace(/\r/g, ''), out)
    this.buffer = ''
    if (this.pending) out.push({ kind: 'text', line: this.pending })
    this.pending = ''
    return out
  }

  private line(text: string, out: StreamItem[]): void {
    // A new object starts: whatever was pending was not JSON after all.
    if (this.pending && text.trimStart().startsWith('{"')) this.giveUp(out)
    const candidate = this.pending ? this.pending + text : text.trim()
    if (!candidate) return
    if (candidate.startsWith('{')) {
      try {
        const event = parseAgyEvent(JSON.parse(candidate))
        this.pending = ''
        this.pendingLines = 0
        if (event) out.push({ kind: 'event', event })
        return
      } catch {
        if (candidate.length < MAX_PENDING && this.pendingLines < MAX_PENDING_LINES) {
          this.pending = candidate
          this.pendingLines++
          return
        }
        this.pending = ''
        this.pendingLines = 0
      }
    }
    out.push({ kind: 'text', line: candidate })
  }

  private giveUp(out: StreamItem[]): void {
    out.push({ kind: 'text', line: this.pending })
    this.pending = ''
    this.pendingLines = 0
  }
}
