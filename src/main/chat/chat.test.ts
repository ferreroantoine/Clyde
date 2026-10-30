import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSessionInfo, AgentStart } from '@shared/agent'
import { dateGroup, replayPrompt, titleFrom, type ChatMessage } from '@shared/chat'
import type { Profile } from '@shared/profiles'
import type { AgentDefinition } from '@shared/tasks'
import { migrate } from '../services/db/database'
import { ChatStore } from './store'
import { ChatService, type ChatSessions } from './service'
import type { ImageInput } from '../agents/api/chat'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, safeStorage: {} }))

const IDS: Record<string, string> = { anthropic: '1b0c3d6e-7f00-4a00-9b00-000000000001', 'claude-code': '1b0c3d6e-7f00-4a00-9b00-000000000002' }
const profile = (kind: Profile['kind'], auth: Profile['auth']): Profile =>
  ({ id: IDS[kind] as string, kind, auth, name: kind, label: '', color: '#64748b', defaultModel: '', baseUrl: '', usable: true }) as unknown as Profile

function setup() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  const root = mkdtempSync(join(tmpdir(), 'clyde-chat-'))
  const workspace = mkdtempSync(join(tmpdir(), 'clyde-ws-'))
  const starts: AgentStart[] = []
  const sent: Array<{ id: string; text: string; images: ImageInput[] }> = []
  const stopped: string[] = []
  const infos = new Map<string, AgentSessionInfo>()
  let n = 0
  const sessions: ChatSessions = {
    start: async (req) => {
      starts.push(req)
      const info = { id: `as-${++n}`, status: 'idle', profileId: req.profileId } as AgentSessionInfo
      infos.set(info.id, info)
      return info
    },
    send: (id, text, images = []) => void sent.push({ id, text, images }),
    interrupt: async () => undefined,
    stop: (id) => {
      stopped.push(id)
      const info = infos.get(id)
      if (info) infos.set(id, { ...info, status: 'stopped' })
    },
    get: (id) => infos.get(id) ?? null
  }
  const agent = { id: '6a3f8f0e-2a52-4a07-9a5e-2f0d3c1b9a11', name: 'Helper', profileId: IDS['anthropic'] as string, model: '', systemPrompt: 'Be brief.', permissionLevel: 'files-auto', mcpTools: ['mcp__docs__search'] } as AgentDefinition
  const messages: ChatMessage[] = []
  const chat = new ChatService({
    store: new ChatStore(db),
    sessions,
    profiles: () => [profile('anthropic', 'api-key'), profile('claude-code', 'subscription')],
    agents: () => [agent],
    root,
    workspaceRoot: () => workspace,
    defaultPermission: () => 'validate-all',
    onChanged: () => undefined,
    onMessage: (m) => messages.push(m),
    onLive: () => undefined
  })
  const answer = (sessionId: string, ...events: AgentEvent[]) => {
    for (const event of events) chat.onAgentEvent({ sessionId, seq: 0, event })
  }
  const done: AgentEvent = { type: 'turn_end', isError: false, subtype: 'success', errors: [], costUsd: null, inputTokens: 10, outputTokens: 5, durationMs: 1 }
  return { db, chat, starts, sent, stopped, messages, answer, done, root, workspace, agent }
}

describe('chat helpers', () => {
  it('titles a conversation from its first line', () => {
    expect(titleFrom('  How do I\nparse JSON?')).toBe('How do I')
    expect(titleFrom('x'.repeat(80))).toHaveLength(58)
    expect(titleFrom('   ')).toBe('')
  })

  it('groups conversations by day', () => {
    const now = new Date(2026, 9, 29, 15).getTime()
    expect(dateGroup({ pinned: true, updatedAt: 0 }, now)).toBe('pinned')
    expect(dateGroup({ pinned: false, updatedAt: new Date(2026, 9, 29, 1).getTime() }, now)).toBe('today')
    expect(dateGroup({ pinned: false, updatedAt: new Date(2026, 9, 28, 23).getTime() }, now)).toBe('yesterday')
    expect(dateGroup({ pinned: false, updatedAt: new Date(2026, 9, 24).getTime() }, now)).toBe('week')
    expect(dateGroup({ pinned: false, updatedAt: new Date(2026, 9, 5).getTime() }, now)).toBe('month')
    expect(dateGroup({ pinned: false, updatedAt: new Date(2025, 1, 1).getTime() }, now)).toBe('older')
  })

  it('replays the history before a new message', () => {
    expect(replayPrompt([], 'Hi')).toBe('Hi')
    const prompt = replayPrompt(
      [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' }
      ],
      'And now?'
    )
    expect(prompt).toContain('User:\nHi\n\nAssistant:\nHello!')
    expect(prompt.endsWith('And now?')).toBe(true)
  })
})

describe('ChatService', () => {
  it('answers through one read-only session and stores the reply', async () => {
    const h = setup()
    const c = h.chat.create({ profileId: IDS['anthropic'] as string, model: 'claude-x', agentId: h.agent.id })
    await h.chat.send(c.id, 'What is a monad?', [])
    expect(h.starts[0]).toMatchObject({
      profileId: IDS['anthropic'] as string,
      model: 'claude-x',
      permissionLevel: 'validate-all',
      chatId: c.id,
      systemPrompt: 'Be brief.',
      mcpTools: [],
      cwd: join(h.root, c.id)
    })
    expect(h.sent[0]).toMatchObject({ id: 'as-1', text: 'What is a monad?' })
    expect(h.chat.list()[0]?.title).toBe('What is a monad?')
    expect(h.chat.liveState(c.id)).toMatchObject({ sessionId: 'as-1', busy: true })

    h.answer(
      'as-1',
      { type: 'text_delta', key: 'k1', text: 'A monoid ' },
      { type: 'text', key: 'k1', text: 'A monoid in the category of endofunctors.' },
      { type: 'tool_call', toolUseId: 't1', name: 'mcp__docs__search', input: { query: 'monad' }, parentToolUseId: null },
      { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
      h.done
    )
    const reply = h.chat.messages(c.id)[1]
    expect(reply).toMatchObject({ role: 'assistant', content: 'A monoid in the category of endofunctors.', status: 'done' })
    expect(reply?.tools).toEqual([{ name: 'mcp__docs__search', summary: 'monad', isError: false }])
    expect(h.chat.liveState(c.id).busy).toBe(false)

    // The next message goes to the same session, without replaying anything.
    await h.chat.send(c.id, 'Shorter?', [])
    expect(h.starts).toHaveLength(1)
    expect(h.sent[1]).toMatchObject({ id: 'as-1', text: 'Shorter?' })
  })

  it('restarts with the history after an edit, a regeneration or a settings change', async () => {
    const h = setup()
    const c = h.chat.create({ profileId: IDS['anthropic'] as string, model: '', agentId: null })
    await h.chat.send(c.id, 'One', [])
    h.answer('as-1', { type: 'text', key: 'a', text: 'Uno' }, h.done)
    await h.chat.send(c.id, 'Two', [])
    h.answer('as-1', { type: 'text', key: 'b', text: 'Dos' }, h.done)

    await h.chat.regenerate(c.id)
    expect(h.stopped).toContain('as-1')
    expect(h.sent.at(-1)?.id).toBe('as-2')
    expect(h.sent.at(-1)?.text).toContain('User:\nOne\n\nAssistant:\nUno')
    expect(h.sent.at(-1)?.text.endsWith('Two')).toBe(true)
    expect(h.chat.messages(c.id).map((m) => m.content)).toEqual(['One', 'Uno', 'Two'])
    h.answer('as-2', { type: 'text', key: 'c', text: 'Deux' }, h.done)

    const first = h.chat.messages(c.id)[0] as ChatMessage
    await h.chat.edit(c.id, first.id, 'Eins')
    expect(h.chat.messages(c.id).map((m) => m.content)).toEqual(['Eins'])
    expect(h.sent.at(-1)).toMatchObject({ id: 'as-3', text: 'Eins' })
    h.answer('as-3', { type: 'text', key: 'd', text: 'One' }, h.done)

    h.chat.update({ id: c.id, toolsEnabled: true })
    expect(h.stopped).toContain('as-3')
    await h.chat.send(c.id, 'Again', [])
    expect(h.starts.at(-1)?.mcpTools).toEqual([])
    expect(h.sent.at(-1)?.text).toContain('User:\nEins')
  })

  it('keeps a stopped answer and records errors', async () => {
    const h = setup()
    const c = h.chat.create({ profileId: IDS['anthropic'] as string, model: '', agentId: null })
    await h.chat.send(c.id, 'Long story', [])
    h.answer('as-1', { type: 'text_delta', key: 'a', text: 'Once upon' })
    await h.chat.stop(c.id)
    h.answer('as-1', { type: 'turn_end', isError: true, subtype: 'error_during_execution', errors: ['aborted'], costUsd: null, inputTokens: 0, outputTokens: 0, durationMs: 1 })
    expect(h.chat.messages(c.id)[1]).toMatchObject({ content: 'Once upon', status: 'stopped', error: null })

    await h.chat.send(c.id, 'Again', [])
    h.answer('as-1', { type: 'error', message: 'Rate limited' }, { type: 'turn_end', isError: true, subtype: 'error', errors: [], costUsd: null, inputTokens: 0, outputTokens: 0, durationMs: 1 })
    expect(h.chat.messages(c.id)[3]).toMatchObject({ status: 'error', error: 'Rate limited' })
  })

  it('inlines text attachments, sends images to API models and points CLI agents to the file', async () => {
    const h = setup()
    writeFileSync(join(h.workspace, 'notes.md'), '# Notes\n')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    const api = h.chat.create({ profileId: IDS['anthropic'] as string, model: '', agentId: null })
    await h.chat.send(api.id, 'Look', [{ path: 'notes.md' }, { name: 'shot.png', mime: 'image/png', data: png }])
    expect(h.sent[0]?.text).toContain('<attachment name="notes.md">\n# Notes\n\n</attachment>')
    expect(h.sent[0]?.images).toEqual([{ mime: 'image/png', data: png }])
    const saved = h.chat.messages(api.id)[0]?.attachments ?? []
    expect(saved.map((a) => [a.name, a.kind])).toEqual([
      ['notes.md', 'text'],
      ['shot.png', 'image']
    ])
    expect(readFileSync(h.chat.attachmentPath(api.id, saved[1] as (typeof saved)[number])).toString('base64')).toBe(png)

    h.answer('as-1', h.done)
    const cli = h.chat.create({ profileId: IDS['claude-code'] as string, model: '', agentId: null })
    await h.chat.send(cli.id, 'And this?', [{ name: 'shot.png', mime: 'image/png', data: png }])
    expect(h.sent.at(-1)?.images).toEqual([])
    expect(h.sent.at(-1)?.text).toMatch(/attachments\/[0-9a-f]{8}-shot\.png/)
    // One live chat session at a time.
    expect(h.stopped).toContain('as-1')

    await expect(h.chat.send(cli.id, 'x', [{ path: '../outside.txt' }])).rejects.toThrow(/outside the workspace/)
    await expect(h.chat.send(cli.id, 'x', [{ name: 'bin.dat', mime: '', data: Buffer.from([1, 0, 2]).toString('base64') }])).rejects.toThrow(/not a text file/)
  })

  it('sums usage over its sessions, searches, and deletes its files', async () => {
    const h = setup()
    const c = h.chat.create({ profileId: IDS['claude-code'] as string, model: '', agentId: null })
    await h.chat.send(c.id, 'Find the needle', [{ name: 'a.txt', mime: 'text/plain', data: Buffer.from('hay').toString('base64') }])
    for (const id of ['as-1', 'as-9']) {
      h.db.prepare('INSERT OR IGNORE INTO chat_sessions (conversation_id, session_id) VALUES (?, ?)').run(c.id, id)
      h.db
        .prepare(
          `INSERT INTO sessions (id, profile_id, profile_name, kind, cwd, status, started_at, input_tokens, output_tokens, cost_usd, billing)
           VALUES (?, ?, 'cc', 'claude-code', '/', 'stopped', 0, 100, 20, 0.5, 'subscription')`
        )
        .run(id, IDS['claude-code'])
      h.db.prepare(`INSERT INTO session_limit_usage (session_id, window, label, delta_pct, badge) VALUES (?, 'five_hour', '5h', 1.5, ?)`).run(id, id === 'as-9' ? 'estimated' : 'official')
    }
    expect(h.chat.usage(c.id)).toMatchObject({
      billing: 'subscription',
      inputTokens: 200,
      outputTokens: 40,
      limits: [{ window: 'five_hour', deltaPct: 3, badge: 'estimated' }]
    })
    expect(h.chat.search('NEEDLE')).toEqual([c.id])
    expect(h.chat.search('nothing like this')).toEqual([])

    h.chat.update({ id: c.id, pinned: true, title: 'Haystack' })
    expect(h.chat.list()[0]).toMatchObject({ pinned: true, title: 'Haystack' })
    h.chat.delete(c.id)
    expect(h.chat.list()).toEqual([])
    expect(existsSync(join(h.root, c.id))).toBe(false)
  })

  it('continues a conversation in the project without spending a turn', async () => {
    const h = setup()
    const c = h.chat.create({ profileId: IDS['anthropic'] as string, model: 'm', agentId: h.agent.id })
    await h.chat.send(c.id, 'Plan a refactor', [])
    h.answer('as-1', { type: 'text', key: 'a', text: 'Step 1…' }, h.done)
    const sentBefore = h.sent.length
    await h.chat.continueInProject(c.id)
    const start = h.starts.at(-1)
    expect(start).toMatchObject({ cwd: h.workspace, permissionLevel: 'files-auto', mcpTools: ['mcp__docs__search'], agentId: h.agent.id })
    expect(start?.chatId).toBeUndefined()
    expect(start?.systemPrompt).toContain('User: Plan a refactor\n\nAssistant: Step 1…')
    expect(h.sent).toHaveLength(sentBefore)
  })
})
