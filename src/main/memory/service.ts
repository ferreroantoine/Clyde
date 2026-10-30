import { join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import type { Profile } from '@shared/profiles'
import type { MemoryProposal, MemoryScope, MemoryState } from '@shared/memory'
import type { Db } from '../services/db/database'
import type { InternalModel } from '../context/internal'
import {
  blockContent,
  deleteDoc,
  docFileName,
  memoryTokens,
  projectMemoryDir,
  readCore,
  readDocs,
  syncFile,
  writeMemoryFile
} from './files'

export interface MemoryServiceDeps {
  db: Db
  /** `<userData>/memory`, the user's own memory. */
  userDir: string
  workspaceRoot: () => string | null
  profiles: () => Profile[]
  configDir: (profileId: string) => string
  budget: () => number
  internal: InternalModel
  /** A session's transcript as text, for end-of-session proposals. */
  transcript: (sessionId: string) => string
  onChanged: (state: MemoryState) => void
}

interface ProposalRow {
  id: string
  scope: string
  project_root: string | null
  session_id: string | null
  kind: string
  before: string
  after: string
  reason: string
  status: string
  created_at: number
}

const PROPOSE_SYSTEM = [
  'You maintain the long-term memory of coding agents: a short core of facts loaded in every session.',
  'Given the current memory and a work session, propose changes: add durable facts (preferences, conventions, architecture, decisions, useful commands), correct wrong ones.',
  'Never add secrets, credentials, transient details, or anything specific to this one task. Keep each core short, in bullet points, in the language it is written in.',
  'Reply with JSON only: {"user": <full new user core, or null if unchanged>, "project": <full new project core, or null if unchanged>, "reason": "<one sentence>"}.',
  'The user core is about the person (who they are, how they like to work); the project core is about this repository.'
].join(' ')

const CONSOLIDATE_SYSTEM = [
  'You tidy the long-term memory of coding agents.',
  'Merge duplicates, remove what is obsolete or contradicted by later lines, shorten wording, keep every distinct fact. Keep the language and Markdown bullet style.',
  'Reply with the new memory text only, nothing else.'
].join(' ')

/** The first JSON object in a model's reply. */
export function parseProposal(reply: string): { user: string | null; project: string | null; reason: string } | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const data = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return { user: text(data['user']), project: text(data['project']), reason: typeof data['reason'] === 'string' ? data['reason'] : '' }
  } catch {
    return null
  }
}

/**
 * The memory shared by every agent. Clyde's Markdown files are the source of truth; each
 * provider gets them its own way: CLAUDE.md / AGENTS.md / GEMINI.md for the CLIs, the system
 * prompt for API accounts. Agents propose changes; only the user applies them.
 */
export class MemoryService {
  constructor(private readonly deps: MemoryServiceDeps) {}

  state(): MemoryState {
    const root = this.deps.workspaceRoot()
    const userCore = readCore(this.deps.userDir)
    const projectCore = root ? readCore(projectMemoryDir(root)) : ''
    return {
      budget: this.deps.budget(),
      user: { dir: this.deps.userDir, core: userCore, docs: readDocs(this.deps.userDir), tokens: memoryTokens(userCore) },
      project: root
        ? { root, dir: projectMemoryDir(root), core: projectCore, docs: readDocs(projectMemoryDir(root)), tokens: memoryTokens(projectCore) }
        : null,
      proposals: this.proposals()
    }
  }

  saveCore(scope: MemoryScope, text: string): MemoryState {
    const { redacted } = writeMemoryFile(join(this.dir(scope), 'core.md'), text)
    return this.afterWrite(redacted)
  }

  saveDoc(scope: MemoryScope, name: string | null, title: string, content: string): MemoryState {
    const file = name ?? docFileName(title)
    const { redacted } = writeMemoryFile(join(this.dir(scope), 'docs', file), content)
    return this.afterWrite(redacted)
  }

  removeDoc(scope: MemoryScope, name: string): MemoryState {
    deleteDoc(this.dir(scope), name)
    return this.afterWrite(false)
  }

  /**
   * Writes the managed blocks. Project: CLAUDE.md (Claude Code) and AGENTS.md (Codex, and
   * Antigravity's project rules), plus GEMINI.md only where one exists (Antigravity reads it
   * first). User: each account's own global file, never a repository.
   */
  sync(): void {
    const root = this.deps.workspaceRoot()
    if (root) {
      const dir = projectMemoryDir(root)
      const content = blockContent(readCore(dir), readDocs(dir), relative(root, join(dir, 'docs')).split('\\').join('/'))
      syncFile(join(root, 'CLAUDE.md'), content, true)
      syncFile(join(root, 'AGENTS.md'), content, true)
      syncFile(join(root, 'GEMINI.md'), content, false)
    }
    const user = blockContent(readCore(this.deps.userDir), readDocs(this.deps.userDir), join(this.deps.userDir, 'docs'))
    for (const profile of this.deps.profiles()) {
      // Only the CLIs read a global file; API and Ollama accounts get the memory in their prompt.
      if (profile.kind !== 'claude-code' && profile.kind !== 'codex' && profile.kind !== 'antigravity') continue
      const dir = this.deps.configDir(profile.id)
      if (profile.kind === 'claude-code') syncFile(join(dir, 'CLAUDE.md'), user, true)
      else if (profile.kind === 'codex') syncFile(join(dir, 'AGENTS.md'), user, true)
      else if (profile.kind === 'antigravity') syncFile(join(dir, '.gemini', 'GEMINI.md'), user, true)
    }
  }

  /** The memory for an API agent's system prompt: both cores and where the notes are. */
  forPrompt(): string {
    const root = this.deps.workspaceRoot()
    const user = readCore(this.deps.userDir).trim()
    const projectDir = root ? projectMemoryDir(root) : null
    const project = projectDir ? readCore(projectDir).trim() : ''
    const docs = projectDir ? readDocs(projectDir) : []
    if (!user && !project && docs.length === 0) return ''
    return [
      '# Memory',
      user && `## About the user\n${user}`,
      (project || docs.length) && root && `## This project\n${blockContent(project, docs, relative(root, join(projectDir as string, 'docs')).split('\\').join('/'))}`
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  proposals(): MemoryProposal[] {
    const rows = this.deps.db.prepare(`SELECT * FROM memory_proposals WHERE status = 'pending' ORDER BY created_at DESC`).all() as ProposalRow[]
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope === 'user' ? 'user' : 'project',
      projectRoot: r.project_root,
      sessionId: r.session_id,
      kind: r.kind === 'consolidate' ? 'consolidate' : 'session',
      before: r.before,
      after: r.after,
      reason: r.reason,
      createdAt: r.created_at
    }))
  }

  /** Asks the internal model what a finished session should add to the memory. */
  async proposeFromSession(sessionId: string): Promise<MemoryProposal[]> {
    const transcript = this.deps.transcript(sessionId).slice(-40_000)
    if (transcript.trim().length < 200) return []
    const root = this.deps.workspaceRoot()
    const user = readCore(this.deps.userDir)
    const project = root ? readCore(projectMemoryDir(root)) : ''
    const reply = await this.deps.internal.complete({
      system: PROPOSE_SYSTEM,
      prompt: [`<user_memory>\n${user}\n</user_memory>`, root ? `<project_memory>\n${project}\n</project_memory>` : '', `<session>\n${transcript}\n</session>`].filter(Boolean).join('\n\n')
    })
    const parsed = parseProposal(reply)
    if (!parsed) return []
    const made: MemoryProposal[] = []
    if (parsed.user && parsed.user !== user.trim()) made.push(this.addProposal('user', null, sessionId, 'session', user, parsed.user, parsed.reason))
    if (root && parsed.project && parsed.project !== project.trim()) made.push(this.addProposal('project', root, sessionId, 'session', project, parsed.project, parsed.reason))
    if (made.length) this.deps.onChanged(this.state())
    return made
  }

  /** "Consolidate the memory": a tidier core, shown as a proposal before anything changes. */
  async consolidate(scope: MemoryScope): Promise<MemoryProposal | null> {
    const root = scope === 'project' ? this.deps.workspaceRoot() : null
    if (scope === 'project' && !root) throw new AppError('no_workspace', t('Open a folder first'))
    const before = readCore(this.dir(scope))
    if (!before.trim()) return null
    const after = await this.deps.internal.complete({ system: CONSOLIDATE_SYSTEM, prompt: before })
    if (!after.trim() || after.trim() === before.trim()) return null
    const proposal = this.addProposal(scope, root, null, 'consolidate', before, after, t('Duplicates merged, obsolete lines removed, wording shortened.'))
    this.deps.onChanged(this.state())
    return proposal
  }

  /** Applies a proposal, as reviewed (the user may have edited it). */
  accept(id: string, edited?: string): MemoryState {
    const proposal = this.proposals().find((p) => p.id === id)
    if (!proposal) throw new AppError('not_found', t('This proposal no longer exists'))
    const dir = proposal.scope === 'user' ? this.deps.userDir : projectMemoryDir(proposal.projectRoot ?? '')
    const { redacted } = writeMemoryFile(join(dir, 'core.md'), edited ?? proposal.after)
    this.deps.db.prepare(`UPDATE memory_proposals SET status = 'accepted' WHERE id = ?`).run(id)
    return this.afterWrite(redacted)
  }

  reject(id: string): MemoryState {
    this.deps.db.prepare(`UPDATE memory_proposals SET status = 'rejected' WHERE id = ?`).run(id)
    const state = this.state()
    this.deps.onChanged(state)
    return state
  }

  private addProposal(scope: MemoryScope, root: string | null, sessionId: string | null, kind: 'session' | 'consolidate', before: string, after: string, reason: string): MemoryProposal {
    const id = randomUUID()
    const now = Date.now()
    this.deps.db
      .prepare(
        `INSERT INTO memory_proposals (id, scope, project_root, session_id, kind, before, after, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, scope, root, sessionId, kind, before, after, reason, now)
    return { id, scope, projectRoot: root, sessionId, kind, before, after, reason, createdAt: now }
  }

  private dir(scope: MemoryScope): string {
    if (scope === 'user') return this.deps.userDir
    const root = this.deps.workspaceRoot()
    if (!root) throw new AppError('no_workspace', t('Open a folder first'))
    return projectMemoryDir(root)
  }

  private afterWrite(redacted: boolean): MemoryState {
    this.sync()
    const state = { ...this.state(), redacted }
    this.deps.onChanged(state)
    return state
  }
}
