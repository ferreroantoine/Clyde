/** Paths exchanged over IPC are relative to the workspace root and use `/` separators. */
export type RelPath = string

export interface AppInfo {
  name: string
  version: string
  electron: string
  node: string
  platform: string
  userData: string
  /** Distribution builds (ATELIER_DISTRIBUTION=1) disable Claude subscription profiles. */
  distribution: boolean
}

export interface WorkspaceInfo {
  root: string
  name: string
  isGitRepo: boolean
}

export type EntryKind = 'file' | 'dir'

export interface DirEntry {
  name: string
  path: RelPath
  kind: EntryKind
}

export interface FileContent {
  path: RelPath
  content: string
  size: number
  mtimeMs: number
  /** Set when the file is binary or too large to open as text; `content` is empty then. */
  unsupported: 'binary' | 'too-large' | null
}

export type FsChangeKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface FsChange {
  kind: FsChangeKind
  path: RelPath
}

export interface SearchMatch {
  path: RelPath
  line: number
  column: number
  preview: string
  /** Index of the match inside `preview` (the preview may be cropped). */
  previewStart: number
  matchLength: number
}

export interface SearchResult {
  matches: SearchMatch[]
  truncated: boolean
}

export interface PtyInfo {
  id: string
  shell: string
  cwd: string
  title: string
  /** Windows build, used by xterm to adapt to ConPTY behavior. */
  windowsBuild: number | null
}

export interface IpcError {
  code: string
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }
