// Masks anything that looks like a credential before it reaches a log line.
const PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-***'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-***'],
  [/(authorization["']?\s*[:=]\s*["']?)(?:(?:bearer|basic)\s+)?[^\s"',}]{4,}/gi, '$1***'],
  [/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***'],
  [/((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi, '$1***']
]

export function redact(text: string): string {
  let out = text
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement)
  return out
}
