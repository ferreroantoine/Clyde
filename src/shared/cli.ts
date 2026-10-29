import type { CliProfileKind } from './profiles'

/** Whether a coding CLI is available, where, and which version. */
export interface CliStatus {
  kind: CliProfileKind
  installed: boolean
  path: string | null
  version: string | null
  /** True for the Claude Code binary that ships with Atelier. */
  bundled: boolean
  /** Why it is missing or failed to answer. */
  detail: string | null
}

/** First version-looking token in a `--version` output: `2.1.312 (Claude Code)`, `codex-cli 0.165.0`. */
export function parseVersion(output: string): string | null {
  return /(?<![\d.])(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/.exec(output)?.[1] ?? null
}
