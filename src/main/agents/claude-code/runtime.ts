import { t } from '@shared/i18n'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { AppError } from '@shared/errors'
import { unpackedPath } from '../../services/unpacked'

/** What a Claude Code process needs to run as one profile. */
export interface ProfileRuntime {
  configDir: string
  /** Only for API key profiles. */
  apiKey: string | null
  binary: string
}

/**
 * Variables that would make a CLI or a command use another account or backend than the
 * profile's: inherited keys and tokens, base URLs, Bedrock/Vertex switches, another
 * CLAUDE_CONFIG_DIR or CODEX_HOME, Google credentials, and the markers a parent Claude Code
 * session sets.
 */
const INHERITED_AUTH =
  /^(ANTHROPIC_|CLAUDE_|CLAUDECODE$|OPENAI_|MISTRAL_|CODEX_|GEMINI_|AGY_|GOOGLE_API_KEY$|GOOGLE_APPLICATION_CREDENTIALS$|GOOGLE_CLOUD_|GOOGLE_GEMINI_)/

/** The app's environment without any provider account: what agent processes and their commands get. */
export function withoutAccountVars(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !INHERITED_AUTH.test(key)) env[key] = value
  }
  return env
}

/**
 * Environment for a Claude Code process. The SDK replaces the child environment with this
 * object, so it starts from the app's environment minus anything account-related.
 */
export function buildProfileEnv(
  base: NodeJS.ProcessEnv,
  runtime: Pick<ProfileRuntime, 'configDir' | 'apiKey'>,
  clientApp: string
): Record<string, string> {
  const env = withoutAccountVars(base)
  env['CLAUDE_CONFIG_DIR'] = runtime.configDir
  env['CLAUDE_AGENT_SDK_CLIENT_APP'] = clientApp
  if (runtime.apiKey) env['ANTHROPIC_API_KEY'] = runtime.apiKey
  return env
}

/**
 * The transcript file of a Claude Code session in a profile's config folder
 * (`projects/<encoded cwd>/<id>.jsonl`), or null. The folder name encoding is Claude Code's own,
 * so every project folder is looked at rather than computing it.
 */
export function findClaudeSessionFile(configDir: string, sessionId: string): string | null {
  if (!/^[\w-]+$/.test(sessionId)) return null
  const projects = join(configDir, 'projects')
  let dirs: string[]
  try {
    dirs = readdirSync(projects)
  } catch {
    return null
  }
  for (const dir of dirs) {
    const file = join(projects, dir, `${sessionId}.jsonl`)
    if (existsSync(file)) return file
  }
  return null
}

/**
 * Copies a Claude Code session file from one account's folder to another's, at the same place,
 * so the other account can resume it with its whole conversation. Returns the session id, or
 * null when there is no file to copy.
 */
export function copyClaudeSession(fromConfigDir: string, toConfigDir: string, sessionId: string): string | null {
  const file = findClaudeSessionFile(fromConfigDir, sessionId)
  if (!file) return null
  const target = join(toConfigDir, relative(fromConfigDir, file))
  try {
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(file, target)
  } catch {
    return null
  }
  return sessionId
}

const requireHere = createRequire(__filename)

/** Package names the Agent SDK uses for its native binary, most specific first. */
export function binaryPackages(platform: NodeJS.Platform, arch: string): string[] {
  const base = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
  return platform === 'linux' ? [base, `${base}-musl`] : [base]
}

/** The Claude Code executable: the user's override when set, else the one bundled with the Agent SDK. */
export function resolveClaudeBinary(override: string): string {
  if (override.trim()) {
    if (!existsSync(override)) throw new AppError('claude_code_missing', t('Claude Code was not found at {override}', { override }))
    return override
  }
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  for (const pkg of binaryPackages(process.platform, process.arch)) {
    try {
      const file = unpackedPath(join(dirname(requireHere.resolve(`${pkg}/package.json`)), exe))
      if (existsSync(file)) return file
    } catch {
      // not installed for this platform variant
    }
  }
  throw new AppError(
    'claude_code_missing',
    t('The Claude Code binary bundled with the Agent SDK is missing. Run npm install again, or set its path in Settings.')
  )
}

export interface AuthStatus {
  loggedIn: boolean
  authMethod: string | null
  apiProvider: string | null
  email: string | null
  orgName: string | null
  subscriptionType: string | null
}

/** Parses `claude auth status --json`, tolerating fields that older or newer versions omit. */
export function parseAuthStatus(stdout: string): AuthStatus {
  const raw = JSON.parse(stdout) as Record<string, unknown>
  const str = (key: string) => (typeof raw[key] === 'string' && raw[key] ? (raw[key] as string) : null)
  return {
    loggedIn: raw['loggedIn'] === true,
    authMethod: str('authMethod'),
    apiProvider: str('apiProvider'),
    email: str('email'),
    orgName: str('orgName'),
    subscriptionType: str('subscriptionType')
  }
}

/** Runs `claude auth status`. It reads the profile's config dir and makes no model call. */
export function authStatus(binary: string, env: Record<string, string>, timeoutMs = 30_000): Promise<AuthStatus> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      ['auth', 'status', '--json'],
      { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        // `auth status` exits non-zero when signed out but still prints the JSON.
        try {
          resolve(parseAuthStatus(stdout))
        } catch {
          reject(new AppError('agent_error', t('Claude Code did not report its sign-in state: {message}', { message: err?.message ?? t('no output') })))
        }
      }
    )
  })
}
