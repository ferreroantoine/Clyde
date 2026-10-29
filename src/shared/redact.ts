// Masks anything that looks like a credential before it reaches a log line.
const PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-***'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-***'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza***'],
  [/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}/g, '$1***'],
  [/(authorization["']?\s*[:=]\s*["']?)(?:(?:bearer|basic)\s+)?[^\s"',}]{4,}/gi, '$1***'],
  [/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***'],
  [/((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi, '$1***']
]

export function redact(text: string): string {
  let out = text
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement)
  return out
}

const SECRET_FLAG = /(token|key|secret|password|passwd|auth|credential)/i

/** Command arguments with values that look secret masked, including `--token <value>` pairs. */
export function redactArgs(args: string[]): string[] {
  return args.map((arg, i) => {
    const previous = args[i - 1]
    if (previous && previous.startsWith('-') && !previous.includes('=') && SECRET_FLAG.test(previous)) return '***'
    return redact(arg)
  })
}
