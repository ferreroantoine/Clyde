import { execFile, spawn } from 'node:child_process'
import type { RpcTransport } from '../codex/rpc'
import { lineSplitter } from '../codex/rpc'

/** A CLI child process seen as lines in and out, as the providers drive it. */
export interface CliProcess {
  transport: RpcTransport
  /** Resolves with the exit code (null when killed by a signal). */
  exited: Promise<number | null>
  /** The last lines the process wrote to stderr, for error messages. */
  stderrTail(): string
  kill(): void
}

export interface SpawnOptions {
  file: string
  args: string[]
  /** Replaces the inherited environment entirely. */
  env: Record<string, string>
  cwd: string
}

export type SpawnCli = (opts: SpawnOptions) => CliProcess

const STDERR_LINES = 40

/** Ends the process and its children: on Windows, killing the parent alone leaves them running. */
export function killTree(pid: number | undefined, kill: () => void): void {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    execFile('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined)
  } else {
    kill()
  }
}

/** Starts a CLI with piped stdio, for line-based protocols such as `codex app-server`. */
export const spawnCli: SpawnCli = ({ file, args, env, cwd }) => {
  const child = spawn(file, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const lineListeners: Array<(line: string) => void> = []
  const closeListeners: Array<(reason: Error | null) => void> = []
  const stderr: string[] = []
  child.stdout.on('data', lineSplitter((line) => lineListeners.forEach((l) => l(line))))
  child.stderr.on(
    'data',
    lineSplitter((line) => {
      stderr.push(line)
      if (stderr.length > STDERR_LINES) stderr.shift()
    })
  )
  // Writing to a process that just died raises EPIPE on the stream; the exit path reports it.
  child.stdin.on('error', () => undefined)
  const exited = new Promise<number | null>((resolve) => {
    let done = false
    const finish = (code: number | null, error: Error | null) => {
      if (done) return
      done = true
      closeListeners.forEach((l) => l(error))
      resolve(code)
    }
    child.on('error', (err) => finish(null, err))
    child.on('exit', (code) => finish(code, null))
  })
  return {
    transport: {
      write: (line) => {
        if (child.stdin.writable) child.stdin.write(line)
      },
      onLine: (l) => lineListeners.push(l),
      onClose: (l) => closeListeners.push(l)
    },
    exited,
    stderrTail: () => stderr.join('\n'),
    kill: () => killTree(child.pid, () => child.kill())
  }
}
