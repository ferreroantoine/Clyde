import { sep } from 'node:path'

/**
 * Executables cannot run from inside app.asar. electron-builder copies the ones listed in
 * asarUnpack to app.asar.unpacked; this maps a path to that copy. No-op in development.
 */
export function unpackedPath(path: string): string {
  return path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}
