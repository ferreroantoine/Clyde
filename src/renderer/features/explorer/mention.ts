/** A workspace path as an `@mention` Claude Code resolves itself; quoted when it holds spaces. */
export function mention(path: string): string {
  return /\s/.test(path) ? `@"${path}" ` : `@${path} `
}
