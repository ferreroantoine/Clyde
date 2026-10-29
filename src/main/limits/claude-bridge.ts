import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseClaudeStatusLine, type LimitReading } from '@shared/limits'

/**
 * Claude Code gives `rate_limits` (5-hour and weekly use) only to the status line script.
 * Atelier installs a small bridge as each Claude profile's status line: it saves that input
 * next to the profile's settings, then runs the status line the profile had before, if any,
 * so its output is unchanged. Docs: code.claude.com/docs/en/statusline.
 */
export const BRIDGE_JSON = 'atelier-statusline.json'
export const BRIDGE_PREVIOUS = 'atelier-statusline.previous'
const MARK = 'atelier-statusline'

const PS1 = `# Written by Atelier. Saves the status line input (usage limits) for Atelier,
# then runs the status line this profile had before, if any. Safe to delete with the profile.
$ErrorActionPreference = 'SilentlyContinue'
$dir = $PSScriptRoot
$raw = [Console]::In.ReadToEnd()
if ($raw.Contains('"rate_limits"')) {
  $tmp = Join-Path $dir '${BRIDGE_JSON}.tmp'
  [IO.File]::WriteAllText($tmp, $raw)
  Move-Item -Force -LiteralPath $tmp -Destination (Join-Path $dir '${BRIDGE_JSON}')
}
$prev = Join-Path $dir '${BRIDGE_PREVIOUS}'
if (Test-Path -LiteralPath $prev) {
  $cmd = [IO.File]::ReadAllText($prev).Trim()
  if ($cmd) {
    # Claude Code runs status lines through Git Bash when it is installed, else PowerShell.
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if ($bash) { $raw | & $bash.Source -c $cmd } else { $raw | powershell -NoProfile -Command $cmd }
  }
}
`

const SH = `#!/bin/sh
# Written by Atelier. Saves the status line input (usage limits) for Atelier,
# then runs the status line this profile had before, if any. Safe to delete with the profile.
dir=$(dirname "$0")
input=$(cat)
case "$input" in
  *'"rate_limits"'*) printf '%s' "$input" > "$dir/${BRIDGE_JSON}.tmp" && mv -f "$dir/${BRIDGE_JSON}.tmp" "$dir/${BRIDGE_JSON}" ;;
esac
if [ -s "$dir/${BRIDGE_PREVIOUS}" ]; then
  printf '%s' "$input" | \${SHELL:-sh} -c "$(cat "$dir/${BRIDGE_PREVIOUS}")"
fi
`

/** The status line command for a profile folder. Forward slashes: Git Bash eats backslashes. */
export function bridgeCommand(configDir: string, platform: NodeJS.Platform): string {
  const dir = configDir.replace(/\\/g, '/')
  return platform === 'win32'
    ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${dir}/${MARK}.ps1"`
    : `sh "${dir}/${MARK}.sh"`
}

/**
 * Installs or refreshes the bridge in a Claude profile folder. A status line that is not
 * Atelier's is kept, chained after the bridge. Returns false when settings.json cannot be read,
 * so that a user's file is never overwritten.
 */
export function installBridge(configDir: string, platform: NodeJS.Platform = process.platform): boolean {
  mkdirSync(configDir, { recursive: true })
  const settingsFile = join(configDir, 'settings.json')
  let settings: Record<string, unknown> = {}
  if (existsSync(settingsFile)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, '') || '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
      settings = parsed as Record<string, unknown>
    } catch {
      return false
    }
  }
  const script = platform === 'win32' ? `${MARK}.ps1` : `${MARK}.sh`
  writeFileSync(join(configDir, script), platform === 'win32' ? PS1.replace(/\n/g, '\r\n') : SH, { mode: 0o755 })

  const current = settings['statusLine'] as { type?: string; command?: unknown } | undefined
  const command = bridgeCommand(configDir, platform)
  if (current && typeof current.command === 'string' && !current.command.includes(MARK)) {
    writeFileSync(join(configDir, BRIDGE_PREVIOUS), current.command)
  }
  if (current?.command !== command) {
    settings['statusLine'] = { ...(current ?? {}), type: 'command', command }
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`)
  }
  return true
}

/** The limits in the bridge file, or nothing when it is missing or unreadable. */
export function readBridge(configDir: string): LimitReading[] {
  try {
    return parseClaudeStatusLine(JSON.parse(readFileSync(join(configDir, BRIDGE_JSON), 'utf8').replace(/^\uFEFF/, '')))
  } catch {
    return []
  }
}
