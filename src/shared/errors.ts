import type { IpcError } from './types'

export type ErrorCode =
  | 'invalid_request'
  | 'forbidden'
  | 'not_found'
  | 'no_workspace'
  | 'outside_workspace'
  | 'io_error'
  | 'pty_error'
  | 'search_error'
  | 'secrets_unavailable'
  | 'not_allowed'
  | 'claude_code_missing'
  | 'cli_missing'
  | 'agent_error'
  | 'internal'

/** Error with a stable code that survives the IPC boundary. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function toIpcError(err: unknown): IpcError {
  if (err instanceof AppError) return { code: err.code, message: err.message }
  if (err instanceof Error) return { code: 'internal', message: err.message }
  return { code: 'internal', message: String(err) }
}
