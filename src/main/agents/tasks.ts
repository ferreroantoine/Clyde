import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { AgentEventEnvelope, AgentSessionInfo, AgentStart } from '@shared/agent'
import { AppError } from '@shared/errors'
import { taskInputSchema, type MergeResult, type Task, type TaskChange, type TaskFileDiff, type TaskInput, type TaskOutcome, type TaskStatus } from '@shared/tasks'
import type { Db } from '../services/db/database'
import type { AgentDefinitionsService } from '../services/agent-definitions'
import { branchSlug, type WorktreeService } from '../services/worktrees'

export interface SessionControl {
  start(request: AgentStart): Promise<AgentSessionInfo>
  send(sessionId: string, text: string): void
  stop(sessionId: string): void
  get(sessionId: string): AgentSessionInfo | null
}

interface Row {
  id: string
  title: string
  description: string
  agent_id: string | null
  repo_root: string
  base_branch: string
  branch: string
  worktree_path: string
  status: string
  outcome: string | null
  session_id: string | null
  note: string | null
  merge_commit: string | null
  created_at: number
  updated_at: number
}

const toTask = (r: Row): Task => ({
  id: r.id,
  title: r.title,
  description: r.description,
  agentId: r.agent_id,
  repoRoot: r.repo_root,
  baseBranch: r.base_branch,
  branch: r.branch,
  worktreePath: r.worktree_path,
  status: r.status as TaskStatus,
  outcome: r.outcome as TaskOutcome | null,
  sessionId: r.session_id,
  note: r.note,
  mergeCommit: r.merge_commit,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

/** Instructions every task agent gets on top of its own system prompt. */
export function taskInstructions(task: Pick<Task, 'branch' | 'baseBranch'>): string {
  return [
    `You are working on one task of a Kanban board, in a dedicated git worktree on branch ${task.branch} (based on ${task.baseBranch}).`,
    'Make the changes in this folder. Committing is optional: the user reviews the diff and merges it.',
    'Do not push, and do not switch branches. When you are done, summarize what you changed and how you checked it.'
  ].join(' ')
}

const ENDED = new Set(['stopped', 'error'])

/**
 * The Kanban board: To do → In progress → To review → Done. Each task owns a branch and a
 * worktree; its agent works there, the review shows the diff, and merging brings it home.
 */
export class TaskService {
  constructor(
    private readonly db: Db,
    private readonly deps: {
      worktrees: WorktreeService
      agents: AgentDefinitionsService
      sessions: SessionControl
      workspaceRoot: () => string | null
      onChanged: (tasks: Task[]) => void
    }
  ) {}

  /** Tasks of the repository the open folder belongs to. */
  async list(): Promise<Task[]> {
    const root = await this.repoRoot().catch(() => null)
    if (!root) return []
    const rows = this.db.prepare('SELECT * FROM tasks WHERE repo_root = ? ORDER BY created_at').all(root) as Row[]
    return rows.map(toTask)
  }

  get(id: string): Task {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new AppError('not_found', 'This task no longer exists')
    return toTask(row)
  }

  /** Creating a task creates its branch and worktree, from the branch checked out now. */
  async create(input: TaskInput): Promise<Task> {
    const data = taskInputSchema.parse(input)
    this.deps.agents.get(data.agentId)
    const repoRoot = await this.repoRoot()
    const baseBranch = await this.deps.worktrees.currentBranch(repoRoot)
    const id = randomUUID()
    const ref = await this.deps.worktrees.create(repoRoot, baseBranch, branchSlug(data.title, id))
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, description, agent_id, repo_root, base_branch, branch, worktree_path, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?)`
      )
      .run(id, data.title, data.description, data.agentId, repoRoot, baseBranch, ref.branch, ref.worktreePath, now, now)
    await this.changed()
    return this.get(id)
  }

  /** Starts the task's agent in its worktree with the task as first message. */
  async start(id: string): Promise<Task> {
    const task = this.get(id)
    if (task.status !== 'todo') throw new AppError('invalid_request', 'Only tasks in To do can start')
    await this.runAgent(task, `${task.title}\n\n${task.description}`)
    return this.get(id)
  }

  /** Sends the review comments to the agent, live or restarted in the same worktree. */
  async requestChanges(id: string, comments: string): Promise<Task> {
    const task = this.get(id)
    if (task.status !== 'review') throw new AppError('invalid_request', 'Only tasks in To review take change requests')
    const live = task.sessionId ? this.deps.sessions.get(task.sessionId) : null
    const message = `Changes requested in review:\n\n${comments.trim()}`
    if (live && !ENDED.has(live.status)) {
      this.update(id, { status: 'in_progress', note: null })
      this.deps.sessions.send(live.id, message)
    } else {
      await this.runAgent(
        task,
        `${task.title}\n\n${task.description}\n\nYou already worked on this task: this folder holds your earlier changes.\n\n${message}`
      )
    }
    return this.get(id)
  }

  async changes(id: string): Promise<TaskChange[]> {
    return this.deps.worktrees.changes(this.ref(this.requireWorktree(id)))
  }

  async fileDiff(id: string, path: string): Promise<TaskFileDiff> {
    const task = this.requireWorktree(id)
    const change = (await this.deps.worktrees.changes(this.ref(task))).find((c) => c.path === path)
    if (!change) throw new AppError('not_found', `${path} has no change in this task`)
    return this.deps.worktrees.fileDiff(this.ref(task), change)
  }

  async merge(id: string): Promise<MergeResult> {
    const task = this.get(id)
    if (task.status !== 'review') throw new AppError('invalid_request', 'Only tasks in To review can be merged')
    this.stopSession(task)
    const result = await this.deps.worktrees.merge(this.ref(task), task.title)
    if (result.ok) {
      this.update(id, { status: 'done', outcome: 'merged', merge_commit: result.commit, session_id: null, note: null })
    } else {
      const files = result.conflicts.length ? ` Conflicts: ${result.conflicts.join(', ')}.` : ''
      this.update(id, { note: `${result.reason}${files}`, session_id: null })
    }
    await this.changed()
    return result
  }

  /** Drops the work: the worktree and the branch are deleted. */
  async abandon(id: string): Promise<Task> {
    const task = this.get(id)
    if (task.status === 'done') throw new AppError('invalid_request', 'This task is already done')
    this.stopSession(task)
    await this.deps.worktrees.remove(this.ref(task), { deleteBranch: true })
    this.update(id, { status: 'done', outcome: 'abandoned', session_id: null, note: null })
    await this.changed()
    return this.get(id)
  }

  async delete(id: string): Promise<void> {
    const task = this.get(id)
    if (task.status === 'in_progress' || task.status === 'review') {
      throw new AppError('invalid_request', 'Merge or abandon the task before deleting it')
    }
    if (task.status === 'todo') await this.deps.worktrees.remove(this.ref(task), { deleteBranch: true })
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    await this.changed()
  }

  /** A finished turn sends the task to review; the agent keeps its session for change requests. */
  onAgentEvent(envelope: AgentEventEnvelope): void {
    if (envelope.event.type !== 'turn_end') return
    const task = this.bySession(envelope.sessionId)
    if (!task || task.status !== 'in_progress') return
    const event = envelope.event
    const note = event.isError && event.subtype !== 'success' ? (event.errors[0] ?? 'The agent stopped with an error') : null
    this.update(task.id, { status: 'review', note })
    void this.changed()
  }

  onSession(info: AgentSessionInfo): void {
    if (!ENDED.has(info.status)) return
    const task = this.bySession(info.id)
    if (!task) return
    if (task.status === 'in_progress') this.update(task.id, { status: 'review', note: 'The agent session ended before finishing its turn.' })
    void this.changed()
  }

  /** At startup no session survives: tasks that were running wait for review. */
  recover(): void {
    this.db
      .prepare(
        `UPDATE tasks SET status = 'review', session_id = NULL, note = 'Clyde was closed while the agent was working.', updated_at = ?
         WHERE status = 'in_progress'`
      )
      .run(Date.now())
    this.db.prepare(`UPDATE tasks SET session_id = NULL WHERE session_id IS NOT NULL`).run()
  }

  private async runAgent(task: Task, prompt: string): Promise<void> {
    if (!task.agentId) throw new AppError('invalid_request', 'This task has no agent any more. Create it again with an agent.')
    if (!existsSync(task.worktreePath)) throw new AppError('not_found', `The worktree ${task.worktreePath} is gone`)
    const agent = this.deps.agents.get(task.agentId)
    const session = await this.deps.sessions.start({
      profileId: agent.profileId,
      model: agent.model,
      permissionLevel: agent.permissionLevel,
      cwd: task.worktreePath,
      systemPrompt: [agent.systemPrompt.trim(), taskInstructions(task)].filter(Boolean).join('\n\n'),
      mcpTools: agent.mcpTools,
      agentId: agent.id,
      taskId: task.id
    })
    this.update(task.id, { status: 'in_progress', session_id: session.id, note: null })
    await this.changed()
    this.deps.sessions.send(session.id, prompt)
  }

  private stopSession(task: Task): void {
    if (!task.sessionId) return
    try {
      this.deps.sessions.stop(task.sessionId)
    } catch {
      // already gone
    }
  }

  private requireWorktree(id: string): Task {
    const task = this.get(id)
    if (task.status === 'done') throw new AppError('invalid_request', 'This task is done; its worktree is gone')
    return task
  }

  private ref(task: Task) {
    return { repoRoot: task.repoRoot, baseBranch: task.baseBranch, branch: task.branch, worktreePath: task.worktreePath }
  }

  private bySession(sessionId: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE session_id = ?').get(sessionId) as Row | undefined
    return row ? toTask(row) : null
  }

  private update(id: string, fields: Partial<Pick<Row, 'status' | 'outcome' | 'session_id' | 'note' | 'merge_commit'>>): void {
    const keys = Object.keys(fields) as Array<keyof typeof fields>
    if (!keys.length) return
    this.db
      .prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k] ?? null), Date.now(), id)
  }

  private async repoRoot(): Promise<string> {
    const folder = this.deps.workspaceRoot()
    if (!folder) throw new AppError('no_workspace', 'Open a folder first')
    if (!(await this.deps.worktrees.isRepo(folder))) {
      throw new AppError('invalid_request', 'Tasks need a git repository. Open a folder that is one, or run git init.')
    }
    return this.deps.worktrees.topLevel(folder)
  }

  private async changed(): Promise<void> {
    this.deps.onChanged(await this.list())
  }
}
