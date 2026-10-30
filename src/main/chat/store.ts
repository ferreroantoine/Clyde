import { randomUUID } from 'node:crypto'
import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import type { Billing, SessionLimitUsage } from '@shared/limits'
import type { ChatAttachment, ChatMessage, ChatMessageStatus, ChatToolUse, ChatUsage, Conversation } from '@shared/chat'
import type { Db } from '../services/db/database'

interface ConversationRow {
  id: string
  title: string
  pinned: number
  agent_id: string | null
  profile_id: string
  effort: string
  model: string
  use_history: number
  tools_enabled: number
  created_at: number
  updated_at: number
}

interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  attachments: string
  tools: string
  status: string
  error: string | null
  created_at: number
}

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  title: r.title,
  pinned: r.pinned === 1,
  agentId: r.agent_id,
  profileId: r.profile_id,
  model: r.model,
  effort: (r.effort ?? '') as Conversation['effort'],
  toolsEnabled: r.tools_enabled === 1,
  useHistory: r.use_history === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role === 'assistant' ? 'assistant' : 'user',
  content: r.content,
  attachments: JSON.parse(r.attachments) as ChatAttachment[],
  tools: JSON.parse(r.tools) as ChatToolUse[],
  status: r.status as ChatMessageStatus,
  error: r.error,
  createdAt: r.created_at
})

/** Conversations and their messages in SQLite. */
export class ChatStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now
  ) {}

  list(): Conversation[] {
    const rows = this.db.prepare('SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC').all() as ConversationRow[]
    return rows.map(toConversation)
  }

  get(id: string): Conversation {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined
    if (!row) throw new AppError('not_found', t('This conversation no longer exists'))
    return toConversation(row)
  }

  create(data: { agentId: string | null; profileId: string; model: string; effort?: Conversation['effort']; toolsEnabled?: boolean }): Conversation {
    const id = randomUUID()
    const now = this.now()
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, agent_id, profile_id, model, effort, tools_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, '', data.agentId, data.profileId, data.model, data.effort ?? '', data.toolsEnabled ? 1 : 0, now, now)
    return this.get(id)
  }

  update(id: string, fields: Partial<Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>>, touch = false): Conversation {
    const current = this.get(id)
    const next = { ...current, ...fields }
    this.db
      .prepare(
        `UPDATE conversations SET title = ?, pinned = ?, agent_id = ?, profile_id = ?, model = ?, effort = ?, tools_enabled = ?, use_history = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        next.title,
        next.pinned ? 1 : 0,
        next.agentId,
        next.profileId,
        next.model,
        next.effort,
        next.toolsEnabled ? 1 : 0,
        next.useHistory ? 1 : 0,
        touch ? this.now() : current.updatedAt,
        id
      )
    return this.get(id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  }

  messages(conversationId: string): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at, rowid')
      .all(conversationId) as MessageRow[]
    return rows.map(toMessage)
  }

  message(id: string): ChatMessage {
    const row = this.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as MessageRow | undefined
    if (!row) throw new AppError('not_found', t('This message no longer exists'))
    return toMessage(row)
  }

  addMessage(message: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
    const id = randomUUID()
    // Strictly increasing, so two messages in the same millisecond keep their order.
    const last = this.db.prepare('SELECT MAX(created_at) AS at FROM chat_messages WHERE conversation_id = ?').get(message.conversationId) as {
      at: number | null
    }
    const at = Math.max(this.now(), (last.at ?? 0) + 1)
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, conversation_id, role, content, attachments, tools, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        message.conversationId,
        message.role,
        message.content,
        JSON.stringify(message.attachments),
        JSON.stringify(message.tools),
        message.status,
        message.error,
        at
      )
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(this.now(), message.conversationId)
    return this.message(id)
  }

  setContent(id: string, content: string): void {
    this.db.prepare('UPDATE chat_messages SET content = ? WHERE id = ?').run(content, id)
  }

  /** Deletes the messages that come after `messageId` (and it too, unless `keep`). */
  truncate(conversationId: string, messageId: string, keep: boolean): void {
    const from = this.message(messageId)
    this.db
      .prepare(`DELETE FROM chat_messages WHERE conversation_id = ? AND created_at ${keep ? '>' : '>='} ?`)
      .run(conversationId, from.createdAt)
  }

  linkSession(conversationId: string, sessionId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO chat_sessions (conversation_id, session_id) VALUES (?, ?)').run(conversationId, sessionId)
  }

  /** Conversations whose title or messages contain the text, case-insensitive. */
  search(query: string): string[] {
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    const rows = this.db
      .prepare(
        `SELECT id FROM conversations WHERE title LIKE ? ESCAPE '\\'
         UNION SELECT conversation_id AS id FROM chat_messages WHERE content LIKE ? ESCAPE '\\'`
      )
      .all(like, like) as Array<{ id: string }>
    return rows.map((r) => r.id)
  }

  /** Tokens, cost and plan use of every session that answered in this conversation. */
  usage(conversationId: string, billing: Billing): ChatUsage {
    const totals = this.db
      .prepare(
        `SELECT COALESCE(SUM(s.input_tokens), 0) AS input, COALESCE(SUM(s.output_tokens), 0) AS output,
                COALESCE(SUM(s.cost_usd), 0) AS cost, COALESCE(MAX(s.cost_estimated), 0) AS estimated
         FROM chat_sessions c JOIN sessions s ON s.id = c.session_id WHERE c.conversation_id = ?`
      )
      .get(conversationId) as { input: number; output: number; cost: number; estimated: number }
    const limits = this.db
      .prepare(
        `SELECT u.window, MIN(u.label) AS label, SUM(u.delta_pct) AS delta, MAX(u.badge = 'estimated') AS estimated
         FROM chat_sessions c JOIN session_limit_usage u ON u.session_id = c.session_id
         WHERE c.conversation_id = ? GROUP BY u.window ORDER BY u.window`
      )
      .all(conversationId) as Array<{ window: string; label: string; delta: number; estimated: number }>
    return {
      billing,
      inputTokens: totals.input,
      outputTokens: totals.output,
      costUsd: totals.cost,
      costEstimated: totals.estimated === 1,
      limits: limits.map(
        (l): SessionLimitUsage => ({ window: l.window, label: l.label, deltaPct: l.delta, badge: l.estimated ? 'estimated' : 'official' })
      )
    }
  }
}
