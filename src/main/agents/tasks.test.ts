import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionInfo, AgentStart } from '@shared/agent'
import { migrate } from '../services/db/database'
import { SecretsService } from '../services/secrets'
import { ProfilesService } from '../services/profiles'
import { AgentDefinitionsService } from '../services/agent-definitions'
import { WorktreeService } from '../services/worktrees'
import { TaskService, type SessionControl } from './tasks'

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('no electron in tests') } }, safeStorage: {} }))

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function setup() {
  const repo = mkdtempSync(join(tmpdir(), 'clyde-board-'))
  sh(repo, 'init', '-q', '-b', 'main')
  sh(repo, 'config', 'user.email', 'me@example.com')
  sh(repo, 'config', 'user.name', 'Me')
  // Git for Windows checks files out with CRLF by default; the assertions compare exact bytes.
  sh(repo, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(repo, 'README.md'), '# demo\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-qm', 'init')

  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  const profiles = new ProfilesService(db, new SecretsService(db, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' }), {
    dataRoot: mkdtempSync(join(tmpdir(), 'clyde-p-')),
    distribution: false
  })
  const profile = profiles.create({ kind: 'ollama', name: 'Local', color: '#64748b', auth: 'none' })
  const agents = new AgentDefinitionsService(db)
  const agent = agents.create({ name: 'Coder', profileId: profile.id, model: 'qwen3', systemPrompt: 'Be careful.', mcpTools: ['mcp__docs__search'] })

  const sessions = new Map<string, AgentSessionInfo>()
  const starts: AgentStart[] = []
  const sent: Array<{ id: string; text: string }> = []
  const control: SessionControl = {
    start: async (req) => {
      starts.push(req)
      const info = { id: `as-${starts.length}`, status: 'idle', taskId: req.taskId ?? null } as AgentSessionInfo
      sessions.set(info.id, info)
      return info
    },
    send: (id, text) => void sent.push({ id, text }),
    stop: (id) => {
      const s = sessions.get(id)
      if (s) s.status = 'stopped'
    },
    get: (id) => sessions.get(id) ?? null
  }
  const changed = vi.fn()
  const tasks = new TaskService(db, {
    worktrees: new WorktreeService(mkdtempSync(join(tmpdir(), 'clyde-wts-'))),
    agents,
    sessions: control,
    workspaceRoot: () => repo,
    onChanged: changed
  })
  const turnEnd = (sessionId: string, isError = false) =>
    tasks.onAgentEvent({
      sessionId,
      seq: 1,
      event: { type: 'turn_end', isError, subtype: isError ? 'error_during_execution' : 'success', errors: isError ? ['boom'] : [], costUsd: null, inputTokens: 1, outputTokens: 1, durationMs: 1 }
    })
  return { repo, db, tasks, agent, agents, starts, sent, sessions, turnEnd, changed }
}

describe('TaskService', () => {
  it('runs a task through the board and merges it into the base branch', async () => {
    const h = setup()
    const task = await h.tasks.create({ title: 'Add a license', description: 'Add an MIT LICENSE file.', agentId: h.agent.id })
    expect(task).toMatchObject({ status: 'todo', baseBranch: 'main', branch: expect.stringMatching(/^clyde\/add-a-license-/) })
    expect(existsSync(task.worktreePath)).toBe(true)
    expect(await h.tasks.list()).toHaveLength(1)

    const started = await h.tasks.start(task.id)
    expect(started).toMatchObject({ status: 'in_progress', sessionId: 'as-1' })
    expect(h.starts[0]).toMatchObject({
      cwd: task.worktreePath,
      model: 'qwen3',
      mcpTools: ['mcp__docs__search'],
      agentId: h.agent.id,
      taskId: task.id,
      systemPrompt: expect.stringContaining('Be careful.')
    })
    expect(h.starts[0]?.systemPrompt).toContain(task.branch)
    expect(h.sent[0]).toEqual({ id: 'as-1', text: 'Add a license\n\nAdd an MIT LICENSE file.' })

    writeFileSync(join(task.worktreePath, 'LICENSE'), 'MIT\n')
    h.turnEnd('as-1')
    expect(h.tasks.get(task.id).status).toBe('review')
    expect(await h.tasks.changes(task.id)).toEqual([{ path: 'LICENSE', oldPath: null, status: 'added' }])
    expect(await h.tasks.fileDiff(task.id, 'LICENSE')).toMatchObject({ original: '', modified: 'MIT\n' })

    // Change requests go to the live session.
    await h.tasks.requestChanges(task.id, 'Add the year.')
    expect(h.tasks.get(task.id).status).toBe('in_progress')
    expect(h.sent.at(-1)).toEqual({ id: 'as-1', text: 'Changes requested in review:\n\nAdd the year.' })
    h.turnEnd('as-1')

    const merged = await h.tasks.merge(task.id)
    expect(merged.ok).toBe(true)
    expect(h.tasks.get(task.id)).toMatchObject({ status: 'done', outcome: 'merged', sessionId: null })
    expect(readFileSync(join(h.repo, 'LICENSE'), 'utf8')).toBe('MIT\n')
    expect(h.sessions.get('as-1')?.status).toBe('stopped')
    expect(existsSync(task.worktreePath)).toBe(false)
  })

  it('restarts a stopped agent in the same worktree for change requests', async () => {
    const h = setup()
    const task = await h.tasks.create({ title: 'Fix', description: 'Fix it.', agentId: h.agent.id })
    await h.tasks.start(task.id)
    const session = h.sessions.get('as-1')
    if (!session) throw new Error('no session')
    session.status = 'stopped'
    h.tasks.onSession(session)
    expect(h.tasks.get(task.id)).toMatchObject({ status: 'review', note: expect.stringMatching(/ended/) })
    await h.tasks.requestChanges(task.id, 'Try again.')
    expect(h.starts).toHaveLength(2)
    expect(h.starts[1]?.cwd).toBe(task.worktreePath)
    expect(h.sent.at(-1)?.text).toMatch(/earlier changes[\s\S]*Try again\./)
  })

  it('keeps the task in review with a note when the merge conflicts', async () => {
    const h = setup()
    const task = await h.tasks.create({ title: 'Edit readme', description: 'Edit.', agentId: h.agent.id })
    await h.tasks.start(task.id)
    writeFileSync(join(task.worktreePath, 'README.md'), '# agent\n')
    h.turnEnd('as-1')
    writeFileSync(join(h.repo, 'README.md'), '# me\n')
    sh(h.repo, 'commit', '-qam', 'mine')
    const result = await h.tasks.merge(task.id)
    expect(result).toMatchObject({ ok: false, conflicts: ['README.md'] })
    expect(h.tasks.get(task.id)).toMatchObject({ status: 'review', note: expect.stringMatching(/Conflicts: README.md/) })
  })

  it('abandons, deletes and recovers tasks', async () => {
    const h = setup()
    const a = await h.tasks.create({ title: 'A', description: 'a', agentId: h.agent.id })
    await h.tasks.start(a.id)
    const abandoned = await h.tasks.abandon(a.id)
    expect(abandoned).toMatchObject({ status: 'done', outcome: 'abandoned' })
    expect(existsSync(a.worktreePath)).toBe(false)
    expect(sh(h.repo, 'branch', '--list', 'clyde/*')).toBe('')

    const b = await h.tasks.create({ title: 'B', description: 'b', agentId: h.agent.id })
    await h.tasks.start(b.id)
    await expect(h.tasks.delete(b.id)).rejects.toThrow(/Merge or abandon/)
    h.tasks.recover()
    expect(h.tasks.get(b.id)).toMatchObject({ status: 'review', sessionId: null, note: expect.stringMatching(/closed/) })

    const c = await h.tasks.create({ title: 'C', description: 'c', agentId: h.agent.id })
    await h.tasks.delete(c.id)
    expect(existsSync(c.worktreePath)).toBe(false)
    await expect(h.tasks.start(c.id)).rejects.toThrow(/no longer exists/)
  })

  it('marks errored turns and refuses invalid moves', async () => {
    const h = setup()
    const task = await h.tasks.create({ title: 'T', description: 't', agentId: h.agent.id })
    await expect(h.tasks.merge(task.id)).rejects.toThrow(/To review/)
    await h.tasks.start(task.id)
    await expect(h.tasks.start(task.id)).rejects.toThrow(/To do/)
    h.turnEnd('as-1', true)
    expect(h.tasks.get(task.id)).toMatchObject({ status: 'review', note: 'boom' })
  })

  it('keeps the board order and reorders within a column', async () => {
    const h = setup()
    const make = (title: string) => h.tasks.create({ title, description: 'Do it.', agentId: h.agent.id })
    const a = await make('A')
    const b = await make('B')
    const c = await make('C')
    const titles = async () => (await h.tasks.list()).map((x) => x.title)
    expect(await titles()).toEqual(['A', 'B', 'C'])
    await h.tasks.reorder(c.id, a.id)
    expect(await titles()).toEqual(['C', 'A', 'B'])
    await h.tasks.reorder(c.id, b.id)
    expect(await titles()).toEqual(['A', 'C', 'B'])
    await h.tasks.reorder(a.id, null)
    expect(await titles()).toEqual(['C', 'B', 'A'])
    await h.tasks.start(b.id)
    await expect(h.tasks.reorder(a.id, b.id)).rejects.toThrow(/within a column/)
  })

  it('needs a git repository', async () => {
    const h = setup()
    const plain = mkdtempSync(join(tmpdir(), 'clyde-plain-'))
    const tasks = new TaskService(h.db, {
      worktrees: new WorktreeService(mkdtempSync(join(tmpdir(), 'clyde-wts-'))),
      agents: h.agents,
      sessions: { start: vi.fn(), send: vi.fn(), stop: vi.fn(), get: vi.fn() },
      workspaceRoot: () => plain,
      onChanged: vi.fn()
    })
    await expect(tasks.create({ title: 'X', description: 'x', agentId: h.agent.id })).rejects.toThrow(/git repository/)
    expect(await tasks.list()).toEqual([])
  })
})
