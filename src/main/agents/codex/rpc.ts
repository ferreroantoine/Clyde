import { t } from '@shared/i18n'
import { StringDecoder } from 'node:string_decoder'

/**
 * JSON-RPC 2.0 over newline-delimited JSON, as `codex app-server` speaks it on stdio
 * (the `"jsonrpc"` header is omitted on the wire). Requests go both ways: the server asks
 * the client for approvals, so incoming requests get a handler too.
 */

export interface RpcError {
  code: number
  message: string
  data?: unknown
}

export class RpcRequestError extends Error {
  constructor(
    readonly method: string,
    readonly error: RpcError
  ) {
    super(error.message)
    this.name = 'RpcRequestError'
  }
}

/** The byte streams of the child process, reduced to what the connection needs. */
export interface RpcTransport {
  write(line: string): void
  onLine(listener: (line: string) => void): void
  onClose(listener: (reason: Error | null) => void): void
}

type Id = number | string

interface Pending {
  method: string
  resolve: (result: unknown) => void
  reject: (err: Error) => void
}

export type NotificationHandler = (method: string, params: unknown) => void
/** Answers a server request. Throwing sends a JSON-RPC error back. */
export type RequestHandler = (method: string, params: unknown) => Promise<unknown>

export class RpcConnection {
  private nextId = 1
  private readonly pending = new Map<Id, Pending>()
  private closedWith: Error | null = null
  private notificationHandler: NotificationHandler = () => undefined
  private requestHandler: RequestHandler = async (method) => {
    throw { code: -32601, message: `Method not handled: ${method}` }
  }

  constructor(
    private readonly transport: RpcTransport,
    private readonly log: (line: string) => void = () => undefined
  ) {
    transport.onLine((line) => this.receive(line))
    transport.onClose((reason) => this.close(reason ?? new Error(t('The Codex process exited'))))
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closedWith) return Promise.reject(this.closedWith)
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: resolve as (r: unknown) => void, reject })
      this.send(params === undefined ? { id, method } : { id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closedWith) return
    this.send(params === undefined ? { method } : { method, params })
  }

  /** Fails every pending request; later calls reject at once. */
  close(reason: Error): void {
    if (this.closedWith) return
    this.closedWith = reason
    for (const p of this.pending.values()) p.reject(reason)
    this.pending.clear()
  }

  get closed(): boolean {
    return this.closedWith !== null
  }

  private send(message: Record<string, unknown>): void {
    this.transport.write(`${JSON.stringify(message)}\n`)
  }

  private receive(line: string): void {
    const text = line.trim()
    if (!text) return
    let msg: { id?: Id; method?: string; params?: unknown; result?: unknown; error?: RpcError }
    try {
      msg = JSON.parse(text)
    } catch {
      this.log(`ignoring a line that is not JSON: ${text.slice(0, 200)}`)
      return
    }
    if (msg.method !== undefined && msg.id !== undefined) {
      void this.answer(msg.id, msg.method, msg.params)
    } else if (msg.method !== undefined) {
      try {
        this.notificationHandler(msg.method, msg.params)
      } catch (err) {
        this.log(`notification handler failed for ${msg.method}: ${(err as Error).message}`)
      }
    } else if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.error) pending.reject(new RpcRequestError(pending.method, msg.error))
      else pending.resolve(msg.result ?? null)
    }
  }

  private async answer(id: Id, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.requestHandler(method, params)
      if (!this.closedWith) this.send({ id, result: result ?? null })
    } catch (err) {
      const e = err as Partial<RpcError> & { message?: string }
      const error = { code: typeof e.code === 'number' ? e.code : -32603, message: e.message ?? 'Internal error' }
      if (!this.closedWith) this.send({ id, error })
    }
  }
}

/** Splits a byte stream into lines, keeping a partial last line until the next chunk. */
export function lineSplitter(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffer = ''
  // A multi-byte character can straddle two chunks.
  const decoder = new StringDecoder('utf8')
  return (chunk) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk)
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, index).replace(/\r$/, ''))
      buffer = buffer.slice(index + 1)
    }
  }
}
