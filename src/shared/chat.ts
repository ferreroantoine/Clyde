import { z } from 'zod'
import { tk } from './i18n'
import { profileIdSchema, REASONING_EFFORTS, type ReasoningEffort } from './profiles'
import type { Billing, SessionLimitUsage } from './limits'

/**
 * The Chat view: conversations in the spirit of claude.ai, separate from the agent panel.
 * Each conversation answers through an agent session that only reads (its own folder, where the
 * attachments are) and, when switched on, uses the MCP tools of the chosen agent.
 */
export const conversationIdSchema = z.uuid()

export interface Conversation {
  id: string
  title: string
  pinned: boolean
  /** A saved agent, or null to use `profileId` + `model` directly. */
  agentId: string | null
  profileId: string
  model: string
  /** Reasoning effort; empty is the model's default. */
  effort: ReasoningEffort | ''
  /** The agent's allowed MCP tools are offered to the model. */
  toolsEnabled: boolean
  /** Relevant passages of past conversations are added to each message (local embeddings). */
  useHistory: boolean
  createdAt: number
  updatedAt: number
}

export type AttachmentKind = 'text' | 'image'

export interface ChatAttachment {
  id: string
  name: string
  mime: string
  size: number
  kind: AttachmentKind
}

export interface ChatToolUse {
  name: string
  summary: string
  isError: boolean
}

export type ChatMessageStatus = 'done' | 'error' | 'stopped'

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  /** Markdown. */
  content: string
  attachments: ChatAttachment[]
  /** Tools the assistant used to answer (MCP, reading attachments). */
  tools: ChatToolUse[]
  status: ChatMessageStatus
  error: string | null
  createdAt: number
}

/** What a conversation used, summed over its sessions. */
export interface ChatUsage {
  billing: Billing
  inputTokens: number
  outputTokens: number
  costUsd: number
  costEstimated: boolean
  limits: SessionLimitUsage[]
}

/** Text files up to 512 KB and images up to 10 MB; the model sees the text inline. */
export const MAX_TEXT_ATTACHMENT = 512 * 1024
export const MAX_IMAGE_ATTACHMENT = 10 * 1024 * 1024
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

/** An attachment from the renderer: a file it read (picker, drop from the system), or a workspace path (Explorer drag). */
export const attachmentInputSchema = z.union([
  z.object({
    name: z.string().trim().min(1).max(255),
    mime: z.string().max(100),
    /** Base64. */
    data: z.string().max(Math.ceil((MAX_IMAGE_ATTACHMENT * 4) / 3) + 8)
  }),
  z.object({ path: z.string().min(1).max(4096) })
])
export type AttachmentInput = z.input<typeof attachmentInputSchema>

export const conversationCreateSchema = z.object({
  agentId: z.uuid().nullable().default(null),
  profileId: profileIdSchema,
  model: z.string().trim().max(200).default(''),
  effort: z.enum(REASONING_EFFORTS).or(z.literal('')).default(''),
  toolsEnabled: z.boolean().default(false)
})
export type ConversationCreate = z.input<typeof conversationCreateSchema>

export const conversationUpdateSchema = z.object({
  id: conversationIdSchema,
  title: z.string().trim().min(1, tk('Title is required')).max(200).optional(),
  pinned: z.boolean().optional(),
  agentId: z.uuid().nullable().optional(),
  profileId: profileIdSchema.optional(),
  model: z.string().trim().max(200).optional(),
  effort: z.enum(REASONING_EFFORTS).or(z.literal('')).optional(),
  toolsEnabled: z.boolean().optional(),
  useHistory: z.boolean().optional()
})
export type ConversationUpdate = z.input<typeof conversationUpdateSchema>

export const chatSendSchema = z.object({
  id: conversationIdSchema,
  text: z.string().max(200_000),
  attachments: z.array(attachmentInputSchema).max(10).default([])
})
export type ChatSend = z.input<typeof chatSendSchema>

export const chatEditSchema = z.object({ id: conversationIdSchema, messageId: z.uuid(), text: z.string().trim().min(1).max(200_000) })

/** Live state of a conversation pushed to the renderer: the session streaming its answer. */
export interface ChatLive {
  conversationId: string
  sessionId: string | null
  busy: boolean
}

/** Groups for the conversation list, newest first. */
export type DateGroup = 'pinned' | 'today' | 'yesterday' | 'week' | 'month' | 'older'

export const DATE_GROUP_LABELS: Record<DateGroup, string> = {
  pinned: tk('Pinned'),
  today: tk('Today'),
  yesterday: tk('Yesterday'),
  week: tk('Previous 7 days'),
  month: tk('Previous 30 days'),
  older: tk('Older')
}

/** Which group a conversation goes in, from its last activity and the local day boundaries. */
export function dateGroup(conversation: Pick<Conversation, 'pinned' | 'updatedAt'>, now: number): DateGroup {
  if (conversation.pinned) return 'pinned'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const day = 24 * 3600 * 1000
  const t = conversation.updatedAt
  if (t >= startOfToday.getTime()) return 'today'
  if (t >= startOfToday.getTime() - day) return 'yesterday'
  if (t >= startOfToday.getTime() - 7 * day) return 'week'
  if (t >= startOfToday.getTime() - 30 * day) return 'month'
  return 'older'
}

/** A title from the first message: its first line, trimmed to a readable length. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? ''
  if (!line) return ''
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

/**
 * The prompt that restarts a conversation in a new session (after a restart of the app, an
 * edit or a regeneration): the earlier messages as context, then the new one.
 */
export function replayPrompt(history: Array<Pick<ChatMessage, 'role' | 'content'>>, text: string): string {
  if (history.length === 0) return text
  const lines = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.content.trim()}`)
  return [
    'This conversation continues an earlier one. Here is what was said so far:',
    '<conversation>',
    lines.join('\n\n'),
    '</conversation>',
    'Answer the next message as the assistant of that conversation.',
    '',
    text
  ].join('\n')
}
