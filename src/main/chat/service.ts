import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import type { AgentEventEnvelope, AgentSessionInfo, AgentStart, PermissionLevel } from '@shared/agent'
import {
  IMAGE_MIMES,
  MAX_IMAGE_ATTACHMENT,
  MAX_TEXT_ATTACHMENT,
  conversationCreateSchema,
  conversationUpdateSchema,
  replayPrompt,
  titleFrom,
  type AttachmentInput,
  type ChatAttachment,
  type ChatLive,
  type ChatMessage,
  type ChatToolUse,
  type ChatUsage,
  type Conversation,
  type ConversationCreate,
  type ConversationUpdate
} from '@shared/chat'
import { isApiKind, type Profile } from '@shared/profiles'
import type { AgentDefinition } from '@shared/tasks'
import type { ImageInput } from '../agents/api/chat'
import { resolveInside } from '../services/paths'
import { billingOf } from '../metrics/metrics'
import type { ChatStore } from './store'
import { passagesPrompt, type ChatSearch } from './search'

export interface ChatSessions {
  start(request: AgentStart): Promise<AgentSessionInfo>
  send(sessionId: string, text: string, images?: ImageInput[]): void
  interrupt(sessionId: string): Promise<void>
  stop(sessionId: string): void
  get(sessionId: string): AgentSessionInfo | null
}

export interface ChatServiceDeps {
  store: ChatStore
  sessions: ChatSessions
  profiles: () => Profile[]
  agents: () => AgentDefinition[]
  /** `userData/chat`: one folder per conversation, holding its attachments; the session's cwd. */
  root: string
  workspaceRoot: () => string | null
  /** Settings › Agents › default permission level, for "Continue in the project". */
  defaultPermission: () => PermissionLevel
  onChanged: (conversations: Conversation[]) => void
  onMessage: (message: ChatMessage) => void
  onLive: (live: ChatLive) => void
  /** Past-conversation search, when Settings › Memory & context turns it on. */
  search?: () => ChatSearch | null
  /** A short title for a new conversation from its first exchange; a local model by default. */
  title?: (exchange: string) => Promise<string | null>
}

/** The answer being written by a session, collected from its events. */
interface Turn {
  conversationId: string
  texts: Map<string, string>
  tools: Map<string, ChatToolUse>
  error: string | null
}

const ENDED = new Set(['stopped', 'error'])
const IMAGE_SET = new Set<string>(IMAGE_MIMES)
/** How much of a conversation "Continue in the project" passes on. */
const HANDOFF_CHARS = 40_000

/**
 * The Chat view's conversations. Each one answers through one live agent session at a time;
 * when that session is gone (app restarted, settings changed, a message edited or
 * regenerated) the next message starts a new one with the conversation so far as context.
 */
export class ChatService {
  /** Conversation → its live session, while that session's history matches the stored messages. */
  private readonly live = new Map<string, string>()
  private readonly turns = new Map<string, Turn>()
  /** Sessions the user stopped: their turn ends as "stopped", not as an error. */
  private readonly stopping = new Set<string>()

  constructor(private readonly deps: ChatServiceDeps) {}

  list(): Conversation[] {
    return this.deps.store.list()
  }

  create(input: ConversationCreate): Conversation {
    const data = conversationCreateSchema.parse(input)
    const conversation = this.deps.store.create(data)
    this.changed()
    return conversation
  }

  update(input: ConversationUpdate): Conversation {
    const { id, ...fields } = conversationUpdateSchema.parse(input)
    const before = this.deps.store.get(id)
    const conversation = this.deps.store.update(id, fields)
    // Another account, model, agent or tool set needs a new session; the history follows as context.
    if (
      before.profileId !== conversation.profileId ||
      before.model !== conversation.model ||
      before.effort !== conversation.effort ||
      before.agentId !== conversation.agentId ||
      before.toolsEnabled !== conversation.toolsEnabled
    ) {
      this.dropSession(id)
    }
    this.changed()
    return conversation
  }

  delete(id: string): void {
    this.dropSession(id)
    this.deps.store.delete(id)
    rmSync(this.folder(id), { recursive: true, force: true })
    this.changed()
  }

  messages(id: string): ChatMessage[] {
    return this.deps.store.messages(id)
  }

  search(query: string): string[] {
    return query.trim() ? this.deps.store.search(query.trim()) : this.list().map((c) => c.id)
  }

  usage(id: string): ChatUsage {
    const conversation = this.deps.store.get(id)
    const profile = this.deps.profiles().find((p) => p.id === conversation.profileId)
    return this.deps.store.usage(id, profile ? billingOf(profile) : 'api')
  }

  liveState(id: string): ChatLive {
    const sessionId = this.live.get(id) ?? null
    return { conversationId: id, sessionId, busy: !!sessionId && this.turns.has(sessionId) }
  }

  /** Saves the message and its attachments, then asks the model. */
  async send(id: string, text: string, attachments: AttachmentInput[]): Promise<ChatMessage> {
    const conversation = this.deps.store.get(id)
    if (!text.trim() && attachments.length === 0) throw new AppError('invalid_request', t('Write a message or attach a file'))
    const history = this.deps.store.messages(id)
    const saved = attachments.map((a) => this.saveAttachment(id, a))
    const message = this.deps.store.addMessage({
      conversationId: id,
      role: 'user',
      content: text,
      attachments: saved,
      tools: [],
      status: 'done',
      error: null
    })
    if (!conversation.title) this.deps.store.update(id, { title: titleFrom(text) || saved[0]?.name || t('New conversation') })
    this.deps.onMessage(message)
    this.changed()
    await this.ask(conversation, message, history)
    return message
  }

  /** Replaces a sent message, drops what followed it and asks again. */
  async edit(id: string, messageId: string, text: string): Promise<void> {
    const conversation = this.deps.store.get(id)
    const message = this.deps.store.message(messageId)
    if (message.conversationId !== id || message.role !== 'user') throw new AppError('invalid_request', t('Only your own messages can be edited'))
    this.dropSession(id)
    this.deps.store.truncate(id, messageId, true)
    this.deps.store.setContent(messageId, text)
    const all = this.deps.store.messages(id)
    const index = all.findIndex((m) => m.id === messageId)
    this.changed()
    await this.ask(conversation, { ...message, content: text }, all.slice(0, index))
  }

  /** Asks again for the last answer. */
  async regenerate(id: string): Promise<void> {
    const conversation = this.deps.store.get(id)
    const all = this.deps.store.messages(id)
    const lastUser = all.findLastIndex((m) => m.role === 'user')
    const message = all[lastUser]
    if (!message) throw new AppError('invalid_request', t('There is nothing to regenerate'))
    this.dropSession(id)
    this.deps.store.truncate(id, message.id, true)
    this.changed()
    await this.ask(conversation, message, all.slice(0, lastUser))
  }

  async stop(id: string): Promise<void> {
    const sessionId = this.live.get(id)
    if (!sessionId || !this.turns.has(sessionId)) return
    this.stopping.add(sessionId)
    await this.deps.sessions.interrupt(sessionId)
  }

  /**
   * Opens an agent session in the open project with this conversation as background, without
   * spending a turn on it: the conversation goes into the system prompt.
   */
  async continueInProject(id: string): Promise<AgentSessionInfo> {
    const conversation = this.deps.store.get(id)
    const cwd = this.deps.workspaceRoot()
    if (!cwd) throw new AppError('no_workspace', t('Open a folder first: the agent works inside it.'))
    const agent = this.agentOf(conversation)
    let transcript = this.deps.store
      .messages(id)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.trim()}`)
      .join('\n\n')
    if (transcript.length > HANDOFF_CHARS) transcript = `…\n${transcript.slice(-HANDOFF_CHARS)}`
    const context = [
      `The user continues here a conversation from Clyde's chat, titled "${conversation.title}". It is background for the work in this folder:`,
      '<conversation>',
      transcript,
      '</conversation>',
      'Wait for the user’s next message before acting.'
    ].join('\n')
    return this.deps.sessions.start({
      profileId: conversation.profileId,
      model: conversation.model,
      effort: conversation.effort,
      permissionLevel: agent?.permissionLevel ?? this.deps.defaultPermission(),
      cwd,
      systemPrompt: [agent?.systemPrompt ?? '', context].filter(Boolean).join('\n\n'),
      mcpTools: agent?.mcpTools ?? [],
      ...(agent ? { agentId: agent.id } : {})
    })
  }

  /** Every agent event goes through here; those of chat sessions build the answer. */
  onAgentEvent({ sessionId, event }: AgentEventEnvelope): void {
    const turn = this.turns.get(sessionId)
    if (!turn) return
    switch (event.type) {
      case 'text':
      case 'text_delta':
        turn.texts.set(event.key, event.type === 'text' ? event.text : (turn.texts.get(event.key) ?? '') + event.text)
        break
      case 'tool_call':
        turn.tools.set(event.toolUseId, { name: event.name, summary: summarize(event.input), isError: false })
        break
      case 'tool_result': {
        const tool = turn.tools.get(event.toolUseId)
        if (tool) tool.isError = event.isError
        break
      }
      case 'error':
        turn.error = event.message
        break
      case 'turn_end':
        this.finish(sessionId, event.isError ? 'error' : 'done', event.isError ? (event.errors[0] ?? turn.error) : null, event.subtype)
        break
      case 'status':
        if (ENDED.has(event.status)) this.finish(sessionId, event.status === 'error' ? 'error' : 'stopped', turn.error, 'ended')
        break
    }
  }

  private async ask(conversation: Conversation, message: ChatMessage, history: ChatMessage[]): Promise<void> {
    const profile = this.deps.profiles().find((p) => p.id === conversation.profileId)
    if (!profile) throw new AppError('not_found', t('This account no longer exists'))
    const api = isApiKind(profile.kind)
    const images: ImageInput[] = api
      ? message.attachments
          .filter((a) => a.kind === 'image')
          .map((a) => ({ mime: a.mime, data: readFileSync(this.attachmentPath(conversation.id, a)).toString('base64') }))
      : []
    let text = this.promptFor(conversation.id, message, api)
    const search = conversation.useHistory ? this.deps.search?.() : null
    if (search && message.content.trim()) {
      const passages = await search.search(message.content, conversation.id).catch(() => [])
      const context = passagesPrompt(passages)
      if (context) text = `${context}\n\n${text}`
    }

    let sessionId = this.live.get(conversation.id)
    const current = sessionId ? this.deps.sessions.get(sessionId) : null
    if (!sessionId || !current || ENDED.has(current.status)) {
      // One live chat session at a time: chat should not take the slots of project agents.
      for (const other of [...this.live.keys()]) if (other !== conversation.id) this.dropSession(other)
      const agent = this.agentOf(conversation)
      const info = await this.deps.sessions.start({
        profileId: conversation.profileId,
        model: conversation.model,
        effort: conversation.effort,
        permissionLevel: 'validate-all',
        cwd: this.folder(conversation.id),
        systemPrompt: agent?.systemPrompt ?? '',
        mcpTools: conversation.toolsEnabled ? (agent?.mcpTools ?? []) : [],
        chatId: conversation.id,
        ...(agent ? { agentId: agent.id } : {})
      })
      sessionId = info.id
      this.live.set(conversation.id, sessionId)
      this.deps.store.linkSession(conversation.id, sessionId)
      this.turns.set(sessionId, newTurn(conversation.id))
      this.publishLive(conversation.id)
      this.deps.sessions.send(sessionId, replayPrompt(history.map(forReplay), text), images)
      return
    }
    this.turns.set(sessionId, newTurn(conversation.id))
    this.publishLive(conversation.id)
    this.deps.sessions.send(sessionId, text, images)
  }

  private finish(sessionId: string, status: ChatMessage['status'], error: string | null, subtype: string): void {
    const turn = this.turns.get(sessionId)
    if (!turn) return
    this.turns.delete(sessionId)
    const content = [...turn.texts.values()].map((s) => s.trim()).filter(Boolean).join('\n\n')
    // An interrupted turn keeps what was written so far.
    const byUser = this.stopping.delete(sessionId)
    const interrupted = byUser || ((subtype === 'interrupted' || subtype === 'ended') && status !== 'error')
    const message = this.deps.store.addMessage({
      conversationId: turn.conversationId,
      role: 'assistant',
      content,
      attachments: [],
      tools: [...turn.tools.values()],
      status: interrupted ? 'stopped' : status,
      error: interrupted ? null : error
    })
    this.deps.onMessage(message)
    if (status === 'stopped' || subtype === 'ended') this.live.delete(turn.conversationId)
    this.publishLive(turn.conversationId)
    this.changed()
    if (message.status === 'done' && content) void this.afterAnswer(turn.conversationId, message)
  }

  /** Housekeeping after an answer: index the exchange for search, title a new conversation. */
  private async afterAnswer(conversationId: string, answer: ChatMessage): Promise<void> {
    const all = this.deps.store.messages(conversationId)
    const question = all.slice(0, all.findIndex((m) => m.id === answer.id)).findLast((m) => m.role === 'user')
    const search = this.deps.search?.()
    if (search) {
      try {
        if (question?.content) await search.index(conversationId, question.id, question.content)
        await search.index(conversationId, answer.id, answer.content)
      } catch {
        // Search is best effort: without Ollama, nothing is indexed.
      }
    }
    if (all.length === 2 && question && this.deps.title) {
      const title = await this.deps.title(`User: ${question.content.slice(0, 2_000)}\n\nAssistant: ${answer.content.slice(0, 2_000)}`).catch(() => null)
      const current = this.deps.store.get(conversationId)
      // Only replace the automatic title, never one the user typed.
      if (title && current.title === titleFrom(question.content)) {
        this.deps.store.update(conversationId, { title })
        this.changed()
      }
    }
  }

  /** The message as the model gets it: text attachments inline, the others as files in its folder. */
  private promptFor(conversationId: string, message: ChatMessage, api: boolean): string {
    const parts = [message.content]
    for (const a of message.attachments) {
      const rel = `attachments/${fileName(a)}`
      if (a.kind === 'text') {
        const body = readFileSync(this.attachmentPath(conversationId, a), 'utf8')
        parts.push(`<attachment name="${a.name}">\n${body}\n</attachment>`)
      } else if (!api) {
        // For the model, so in English like the other prompts.
        parts.push(`[Attached image: ${rel} in your working folder. Look at it before answering.]`)
      }
    }
    return parts.filter(Boolean).join('\n\n')
  }

  private saveAttachment(conversationId: string, input: AttachmentInput): ChatAttachment {
    let name: string
    let mime: string
    let data: Buffer
    if ('path' in input) {
      const root = this.deps.workspaceRoot()
      if (!root) throw new AppError('no_workspace', t('Open a folder first'))
      const abs = resolveInside(root, input.path)
      if (statSync(abs).size > MAX_TEXT_ATTACHMENT * 20) throw new AppError('invalid_request', t('{name} is too large to attach', { name: basename(abs) }))
      name = basename(abs)
      data = readFileSync(abs)
      mime = mimeOf(name)
    } else {
      name = basename(input.name)
      mime = input.mime || mimeOf(name)
      data = Buffer.from(input.data, 'base64')
    }
    const kind = IMAGE_SET.has(mime) ? 'image' : 'text'
    if (kind === 'image' && data.length > MAX_IMAGE_ATTACHMENT) throw new AppError('invalid_request', t('{name} is too large to attach', { name }))
    if (kind === 'text') {
      if (data.length > MAX_TEXT_ATTACHMENT) throw new AppError('invalid_request', t('{name} is too large to attach', { name }))
      if (data.includes(0)) throw new AppError('invalid_request', t('{name} is not a text file or an image', { name }))
    }
    const attachment: ChatAttachment = { id: randomUUID(), name, mime: kind === 'text' ? 'text/plain' : mime, size: data.length, kind }
    const dir = join(this.folder(conversationId), 'attachments')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, fileName(attachment)), data)
    return attachment
  }

  attachmentPath(conversationId: string, attachment: Pick<ChatAttachment, 'id' | 'name'>): string {
    return join(this.folder(conversationId), 'attachments', fileName(attachment))
  }

  private folder(conversationId: string): string {
    const dir = join(this.deps.root, conversationId)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  private agentOf(conversation: Conversation): AgentDefinition | undefined {
    return conversation.agentId ? this.deps.agents().find((a) => a.id === conversation.agentId) : undefined
  }

  private dropSession(conversationId: string): void {
    const sessionId = this.live.get(conversationId)
    if (!sessionId) return
    this.live.delete(conversationId)
    this.turns.delete(sessionId)
    try {
      this.deps.sessions.stop(sessionId)
    } catch {
      // already gone
    }
    this.publishLive(conversationId)
  }

  private publishLive(conversationId: string): void {
    this.deps.onLive(this.liveState(conversationId))
  }

  private changed(): void {
    this.deps.onChanged(this.list())
  }
}

function newTurn(conversationId: string): Turn {
  return { conversationId, texts: new Map(), tools: new Map(), error: null }
}

function forReplay(m: ChatMessage): Pick<ChatMessage, 'role' | 'content'> {
  const names = m.attachments.map((a) => `[${a.name}]`).join(' ')
  return { role: m.role, content: [m.content, names].filter(Boolean).join('\n') }
}

/** `attachments/<id>-<name>`, with a name safe on every file system. */
function fileName(a: Pick<ChatAttachment, 'id' | 'name'>): string {
  return `${a.id.slice(0, 8)}-${a.name.replace(/[^\w.-]+/g, '_').slice(-120)}`
}

const IMAGE_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

function mimeOf(name: string): string {
  return IMAGE_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'text/plain'
}

/** A short line for a tool used in an answer: the file it read, the query it searched… */
function summarize(input: Record<string, unknown>): string {
  for (const key of ['path', 'file_path', 'query', 'pattern', 'url', 'command']) {
    const value = input[key]
    if (typeof value === 'string' && value) return value.length > 80 ? `${value.slice(0, 77)}…` : value
  }
  return ''
}
