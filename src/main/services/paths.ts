import { t } from '@shared/i18n'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { AppError } from '@shared/errors'

/** Converts an OS path relative to the root into the `/`-separated form used over IPC. */
export function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/')
}

export function isInside(root: string, abs: string): boolean {
  const rel = relative(root, abs)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Resolves a workspace-relative path to an absolute one and refuses anything
 * that escapes the root (`..`, absolute paths, other drives).
 */
export function resolveInside(root: string, relPath: string): string {
  if (relPath.includes('\0')) throw new AppError('outside_workspace', t('Invalid path'))
  const abs = resolve(root, relPath)
  if (!isInside(root, abs)) throw new AppError('outside_workspace', t('Path is outside the workspace: {relPath}', { relPath }))
  return abs
}
