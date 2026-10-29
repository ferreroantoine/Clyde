import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { AppError } from '@shared/errors'

/** What a Claude Code process needs to run as one profile. */
export interface ProfileRuntime {
  configDir: string
  /** Only for API key profiles. */
  apiKey: string | null
  binary: string
}

/**
 * Variables that would make Claude Code use another account or backend than the profile's:
 * inherited keys and tokens, base URLs, Bedrock/Vertex switches, another CLAUDE_CONFIG_DIR,
 * and the markers a parent Claude Code session sets.
 */
const INHERITED_AUTH = /^(ANTHROPIC_|CLAUDE_|CLAUDECODE$|OPENAI_|MISTRAL_)/

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

const requireHere = createRequire(__filename)

/** Package names the Agent SDK uses for its native binary, most specific first. */
export function binaryPackages(platform: NodeJS.Platform, arch: string): string[] {
  const base = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
  return platform === 'linux' ? [base, `${base}-musl`] : [base]
}

/** The Claude Code executable: the user's override when set, else the one bundled with the Agent SDK. */
export function resolveClaudeBinary(override: string): string {
  if (override.trim()) {
    if (!existsSync(override)) throw new AppError('claude_code_missing', `Claude Code was not found at ${override}`)
    return override
  }
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  for (const pkg of binaryPackages(process.platform, process.arch)) {
    try {
      const file = join(dirname(requireHere.resolve(`${pkg}/package.json`)), exe)
      if (existsSync(file)) return file
    } catch {
      // not installed for this platform variant
    }
  }
  throw new AppError(
    'claude_code_missing',
    'The Claude Code binary bundled with the Agent SDK is missing. Run npm install again, or set its path in Settings.'
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
          reject(new AppError('agent_error', `Claude Code did not report its sign-in state: ${err?.message ?? 'no output'}`))
        }
      }
    )
  })
}
