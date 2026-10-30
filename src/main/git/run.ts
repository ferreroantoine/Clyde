import { spawn } from 'node:child_process'
import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'

export interface RunOptions {
  cwd: string
  /** Written to git's stdin (a patch for `git apply`). */
  input?: string
  env?: Record<string, string>
  /** ms; network commands get longer. */
  timeout?: number
  /** Exit codes that are not failures (`git diff --exit-code` style). */
  okCodes?: number[]
}

export interface RunResult {
  code: number
  stdout: Buffer
  stderr: string
}

export class GitCommandError extends AppError {
  constructor(
    message: string,
    readonly stderr: string,
    readonly stdout: string,
    readonly exitCode: number
  ) {
    super('io_error', message)
  }
}

/** Short, readable text of what git said on failure. */
export function gitMessage(stderr: string, stdout = ''): string {
  const text = (stderr.trim() || stdout.trim())
    .split('\n')
    .map((l) => l.replace(/^(fatal|error|hint): /, '').trim())
    .filter((l) => l && !/^\(use "git /.test(l))
  return text.slice(0, 6).join('\n') || t('unknown error')
}

/**
 * Runs git without a shell. Prompts are off (credentials come from the credential helper, as in
 * a terminal), and output stays in English so it can be parsed.
 */
export function runGit(args: string[], { cwd, input, env, timeout = 30_000, okCodes = [0] }: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=false', ...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', LANG: 'C', ...env },
      windowsHide: true
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => child.kill(), timeout)
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => err.push(b))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new AppError('io_error', t('Could not run git: {message}', { message: e.message })))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const result = { code: code ?? -1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }
      if (signal && code === null) {
        reject(new GitCommandError(t('git took too long and was stopped'), result.stderr, result.stdout.toString('utf8'), -1))
      } else if (!okCodes.includes(result.code)) {
        const stdout = result.stdout.toString('utf8')
        reject(new GitCommandError(gitMessage(result.stderr, stdout), result.stderr, stdout, result.code))
      } else {
        resolve(result)
      }
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

/** stdout as text. */
export async function git(args: string[], options: RunOptions): Promise<string> {
  return (await runGit(args, options)).stdout.toString('utf8')
}
