import { createRequire } from 'node:module'
import type * as NodePty from 'node-pty'

// Loaded on first use: a native module, only needed once an Antigravity run starts.
let nodePty: typeof NodePty | null = null
const loadPty = () => (nodePty ??= createRequire(__filename)('node-pty') as typeof NodePty)

/** A CLI run in a pseudo-terminal, for tools that only write output to a terminal (agy -p). */
export interface PtyProcess {
  onData(listener: (data: string) => void): void
  onExit(listener: (exitCode: number) => void): void
  write(data: string): void
  kill(): void
}

export interface PtySpawnOptions {
  file: string
  args: string[]
  /** Replaces the inherited environment entirely. */
  env: Record<string, string>
  cwd: string
}

export type SpawnPty = (opts: PtySpawnOptions) => PtyProcess

/**
 * Wide enough that JSON lines are not wrapped by the terminal. ConPTY reflows output to the
 * window width, so a narrow pty would cut long events in two.
 */
export const PTY_COLS = 4000

export const spawnPty: SpawnPty = ({ file, args, env, cwd }) => {
  const pty = loadPty().spawn(file, args, { name: 'xterm-256color', cols: PTY_COLS, rows: 50, cwd, env })
  return {
    onData: (l) => void pty.onData(l),
    onExit: (l) => void pty.onExit(({ exitCode }) => l(exitCode)),
    write: (data) => pty.write(data),
    kill: () => {
      try {
        pty.kill()
      } catch {
        // already gone
      }
    }
  }
}
