import { z } from 'zod'
import type { EventChannel, InvokeChannel } from './channels'
import type { Settings } from '../settings'
import { profileCreateSchema, profileIdSchema, profileUpdateSchema, type ConnectionResult, type ModelOption, type Profile } from '../profiles'
import {
  agentDefinitionInputSchema,
  agentDefinitionUpdateSchema,
  agentIdSchema,
  taskIdSchema,
  taskInputSchema,
  type AgentDefinition,
  type MergeResult,
  type Task,
  type TaskChange,
  type TaskFileDiff
} from '../tasks'
import { priceInputSchema, type PriceRow } from '../pricing'
import type { Dashboard, SessionTranscript } from '../metrics'
import type { AppNotice } from '../notices'
import type { CliStatus } from '../cli'
import type { VoiceProgress, VoiceStatus } from '../voice'
import { memorySaveCoreSchema, memorySaveDocSchema, type MemoryState } from '../memory'
import { WHISPER_MODEL_IDS } from '../settings'
import {
  chatEditSchema,
  chatSendSchema,
  conversationCreateSchema,
  conversationIdSchema,
  conversationUpdateSchema,
  type ChatLive,
  type ChatMessage,
  type ChatUsage,
  type Conversation
} from '../chat'
import type { DataPaths, ImportSummary } from '../config-export'
import type { LimitAlert, LimitDiagnostic, LimitHistory, ProfileLimits, SessionLimitUsage } from '../limits'
import { mcpIdSchema, mcpServerInputSchema, mcpServerUpdateSchema, type McpImportPreview, type McpServer } from '../mcp'
import { presetInstallSchema, userPresetInputSchema, type McpPreset, type McpProbe } from '../mcp-catalog'
import {
  agentStartSchema,
  agentSwitchSchema,
  approvalAnswerSchema,
  questionAnswerSchema,
  sessionIdSchema,
  type AgentEventEnvelope,
  type AgentSessionInfo,
  type SessionSummary,
  type StoredSession
} from '../agent'
import type {
  AppInfo,
  DirEntry,
  FileContent,
  FsChange,
  PtyInfo,
  SearchResult,
  WorkspaceInfo
} from '../types'

const relPath = z.string().max(4096)
const ptyId = z.string().min(1).max(64)
const dims = { cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(500) }

/** Request payload schemas, validated in main before any handler runs. */
export const requestSchemas = {
  'app:getInfo': z.undefined(),
  'app:notices': z.undefined(),
  'workspace:pick': z.undefined(),
  'workspace:open': z.object({ root: z.string().min(1).max(4096) }),
  'workspace:current': z.undefined(),
  'fs:list': z.object({ path: relPath }),
  'fs:read': z.object({ path: relPath }),
  'fs:write': z.object({ path: relPath, content: z.string() }),
  'fs:createFile': z.object({ path: relPath }),
  'fs:createDir': z.object({ path: relPath }),
  'fs:rename': z.object({ from: relPath, to: relPath }),
  'fs:duplicate': z.object({ path: relPath }),
  'fs:trash': z.object({ path: relPath }),
  'fs:reveal': z.object({ path: relPath }),
  'search:text': z.object({
    query: z.string().min(1).max(500),
    caseSensitive: z.boolean().default(false),
    regex: z.boolean().default(false),
    maxResults: z.number().int().min(1).max(5000).default(1000)
  }),
  'pty:create': z.object({ cwd: z.string().max(4096).optional(), ...dims }),
  'pty:write': z.object({ id: ptyId, data: z.string().max(1_000_000) }),
  'pty:resize': z.object({ id: ptyId, ...dims }),
  'pty:kill': z.object({ id: ptyId }),
  'settings:getAll': z.undefined(),
  'settings:set': z.object({ path: z.string().min(3).max(128), value: z.unknown() }),
  'settings:resetSection': z.object({ section: z.string().min(1).max(64) }),
  'data:export': z.undefined(),
  'data:import': z.undefined(),
  'data:purge': z.undefined(),
  'data:paths': z.undefined(),
  'data:open': z.object({ target: z.enum(['userData', 'database', 'logs']) }),
  'app:licenses': z.undefined(),
  'app:pickPath': z.object({ kind: z.enum(['folder', 'file']), title: z.string().max(200), defaultPath: z.string().max(4096).optional() }),
  'profiles:list': z.undefined(),
  'profiles:create': profileCreateSchema,
  'profiles:update': profileUpdateSchema,
  'profiles:delete': z.object({ id: profileIdSchema }),
  'profiles:test': z.object({ id: profileIdSchema }),
  'profiles:models': z.object({ id: profileIdSchema, refresh: z.boolean().optional() }),
  'profiles:login': z.object({ id: profileIdSchema, ...dims }),
  'cli:status': z.object({ refresh: z.boolean().default(false) }),
  'agent:list': z.undefined(),
  'agent:start': agentStartSchema,
  'agent:send': z.object({ sessionId: sessionIdSchema, text: z.string().trim().min(1).max(100_000) }),
  'agent:interrupt': z.object({ sessionId: sessionIdSchema }),
  'agent:stop': z.object({ sessionId: sessionIdSchema }),
  'agent:compact': z.object({ sessionId: sessionIdSchema }),
  'agent:continueWithSummary': z.object({ sessionId: sessionIdSchema }),
  /** Recent sessions started in this folder (the open project when absent). */
  'agent:history': z.object({ cwd: z.string().max(4096).optional() }),
  'agent:load': z.object({ sessionId: sessionIdSchema }),
  /** Brings an ended session back; `continue` also tells it to finish what it was doing. */
  'agent:resume': z.object({ sessionId: sessionIdSchema, continue: z.boolean().default(false) }),
  'agent:switch': agentSwitchSchema,
  /** Tells the session to carry on at `at` (ms); absent uses its account's reset time. */
  'agent:scheduleResume': z.object({ sessionId: sessionIdSchema, at: z.number().int().positive().optional() }),
  'agent:cancelResume': z.object({ sessionId: sessionIdSchema }),
  'agent:scheduled': z.undefined(),
  /** An image a tool returned, stored with the session. */
  'agent:media': z.object({ sessionId: sessionIdSchema, id: z.string().regex(/^[a-f0-9]{24}\.[a-z]+$/) }),
  'memory:state': z.undefined(),
  'memory:saveCore': memorySaveCoreSchema,
  'memory:saveDoc': memorySaveDocSchema,
  'memory:deleteDoc': z.object({ scope: z.enum(['user', 'project']), name: z.string().regex(/^[\w.-]+\.md$/) }),
  'memory:propose': z.object({ sessionId: sessionIdSchema }),
  'memory:consolidate': z.object({ scope: z.enum(['user', 'project']) }),
  'memory:accept': z.object({ id: z.uuid(), text: z.string().max(200_000).optional() }),
  'memory:reject': z.object({ id: z.uuid() }),
  'memory:open': z.object({ scope: z.enum(['user', 'project']) }),
  'agent:approve': approvalAnswerSchema,
  'agent:answerQuestion': questionAnswerSchema,
  'mcp:list': z.undefined(),
  'mcp:create': mcpServerInputSchema,
  'mcp:update': mcpServerUpdateSchema,
  'mcp:delete': z.object({ id: mcpIdSchema }),
  'mcp:reconnect': z.object({ id: mcpIdSchema }),
  'mcp:importPreview': z.undefined(),
  'mcp:import': z.object({ path: z.string().min(1).max(4096), names: z.array(z.string().max(200)).max(200) }),
  'mcp:presets': z.undefined(),
  'mcp:installPreset': presetInstallSchema,
  /** Starts a preset with these values (or a server config) without saving it, and lists its tools. */
  'mcp:test': z.union([presetInstallSchema, z.object({ server: mcpServerInputSchema })]),
  'mcp:savePreset': userPresetInputSchema,
  'mcp:deletePreset': z.object({ id: z.uuid() }),
  'agents:list': z.undefined(),
  'agents:create': agentDefinitionInputSchema,
  'agents:update': agentDefinitionUpdateSchema,
  'agents:delete': z.object({ id: agentIdSchema }),
  'tasks:list': z.undefined(),
  'tasks:create': taskInputSchema,
  'tasks:start': z.object({ id: taskIdSchema }),
  'tasks:requestChanges': z.object({ id: taskIdSchema, comments: z.string().trim().min(1).max(50_000) }),
  'tasks:changes': z.object({ id: taskIdSchema }),
  'tasks:fileDiff': z.object({ id: taskIdSchema, path: z.string().min(1).max(4096) }),
  'tasks:merge': z.object({ id: taskIdSchema }),
  'tasks:abandon': z.object({ id: taskIdSchema }),
  'tasks:delete': z.object({ id: taskIdSchema }),
  'tasks:reorder': z.object({ id: taskIdSchema, beforeId: taskIdSchema.nullable() }),
  'chat:list': z.undefined(),
  'chat:create': conversationCreateSchema,
  'chat:update': conversationUpdateSchema,
  'chat:delete': z.object({ id: conversationIdSchema }),
  'chat:messages': z.object({ id: conversationIdSchema }),
  'chat:send': chatSendSchema,
  'chat:edit': chatEditSchema,
  'chat:regenerate': z.object({ id: conversationIdSchema }),
  'chat:stop': z.object({ id: conversationIdSchema }),
  'chat:search': z.object({ query: z.string().max(200) }),
  'chat:usage': z.object({ id: conversationIdSchema }),
  'chat:live': z.object({ id: conversationIdSchema }),
  'chat:continueInProject': z.object({ id: conversationIdSchema }),
  'chat:attachment': z.object({ id: conversationIdSchema, attachmentId: z.uuid() }),
  'voice:status': z.undefined(),
  'voice:installBinary': z.undefined(),
  'voice:downloadModel': z.object({ id: z.enum(WHISPER_MODEL_IDS) }),
  'voice:deleteModel': z.object({ id: z.enum(WHISPER_MODEL_IDS) }),
  'voice:cancel': z.object({ id: z.string().max(64) }),
  /** A 16 kHz mono WAV, base64; ten minutes at most. */
  'voice:transcribe': z.object({ audio: z.string().max(30_000_000) }),
  'voice:micAccess': z.undefined(),
  'metrics:dashboard': z.object({ range: z.enum(['24h', '7d', '30d']).default('7d') }),
  'metrics:transcript': z.object({ sessionId: z.string().min(1).max(64) }),
  'limits:list': z.undefined(),
  'limits:session': z.object({ sessionId: z.string().min(1).max(64) }),
  'limits:history': z.object({ profileId: profileIdSchema, days: z.number().int().min(1).max(30).default(7) }),
  'limits:refresh': z.object({ profileId: profileIdSchema.optional() }),
  'limits:diagnose': z.object({ profileId: profileIdSchema }),
  'pricing:list': z.undefined(),
  'pricing:save': priceInputSchema.extend({ id: z.string().min(1).max(64).optional() }),
  'pricing:delete': z.object({ id: z.string().min(1).max(64) }),
  'files:list': z.undefined()
} satisfies Record<InvokeChannel, z.ZodType>

export interface InvokeResponses {
  'app:getInfo': AppInfo
  'app:notices': AppNotice[]
  'workspace:pick': WorkspaceInfo | null
  'workspace:open': WorkspaceInfo
  'workspace:current': WorkspaceInfo | null
  'fs:list': DirEntry[]
  'fs:read': FileContent
  'fs:write': { mtimeMs: number }
  'fs:createFile': DirEntry
  'fs:createDir': DirEntry
  'fs:rename': DirEntry
  'fs:duplicate': DirEntry
  'fs:trash': null
  'fs:reveal': null
  'search:text': SearchResult
  'pty:create': PtyInfo
  'pty:write': null
  'pty:resize': null
  'pty:kill': null
  'settings:getAll': Settings
  'settings:set': Settings
  'settings:resetSection': Settings
  'data:export': { path: string } | null
  'data:import': ImportSummary | null
  'data:purge': { sessions: number }
  'data:paths': DataPaths
  'data:open': null
  'app:licenses': Array<{ name: string; version: string; license: string }>
  'app:pickPath': string | null
  'profiles:list': Profile[]
  'profiles:create': Profile
  'profiles:update': Profile
  'profiles:delete': null
  'profiles:test': ConnectionResult
  'profiles:models': ModelOption[]
  'profiles:login': PtyInfo
  'cli:status': CliStatus[]
  'agent:list': AgentSessionInfo[]
  'agent:start': AgentSessionInfo
  'agent:send': null
  'agent:interrupt': null
  'agent:stop': null
  'agent:compact': null
  'agent:continueWithSummary': AgentSessionInfo
  'agent:history': SessionSummary[]
  'agent:load': StoredSession
  'agent:resume': AgentSessionInfo
  /** Base64 bytes. */
  'agent:media': { mime: string; data: string }
  'agent:switch': AgentSessionInfo
  /** When the session will be told to carry on (ms). */
  'agent:scheduleResume': number
  'agent:cancelResume': null
  'agent:scheduled': Array<{ sessionId: string; at: number }>
  'memory:state': MemoryState
  'memory:saveCore': MemoryState
  'memory:saveDoc': MemoryState
  'memory:deleteDoc': MemoryState
  /** How many proposals the session produced. */
  'memory:propose': number
  'memory:consolidate': boolean
  'memory:accept': MemoryState
  'memory:reject': MemoryState
  'memory:open': null
  'agent:approve': null
  'agent:answerQuestion': null
  'mcp:list': McpServer[]
  'mcp:create': McpServer[]
  'mcp:update': McpServer[]
  'mcp:delete': null
  'mcp:reconnect': null
  'mcp:importPreview': McpImportPreview | null
  'mcp:import': McpServer[]
  'mcp:presets': McpPreset[]
  'mcp:installPreset': McpServer[]
  'mcp:test': McpProbe
  'mcp:savePreset': McpPreset[]
  'mcp:deletePreset': McpPreset[]
  'agents:list': AgentDefinition[]
  'agents:create': AgentDefinition
  'agents:update': AgentDefinition
  'agents:delete': null
  'tasks:list': Task[]
  'tasks:create': Task
  'tasks:start': Task
  'tasks:requestChanges': Task
  'tasks:changes': TaskChange[]
  'tasks:fileDiff': TaskFileDiff
  'tasks:merge': MergeResult
  'tasks:abandon': Task
  'tasks:delete': null
  'tasks:reorder': Task[]
  'chat:list': Conversation[]
  'chat:create': Conversation
  'chat:update': Conversation
  'chat:delete': null
  'chat:messages': ChatMessage[]
  'chat:send': ChatMessage
  'chat:edit': null
  'chat:regenerate': null
  'chat:stop': null
  'chat:search': string[]
  'chat:usage': ChatUsage
  'chat:live': ChatLive
  'chat:continueInProject': AgentSessionInfo
  /** An attachment's bytes, base64, for image previews. */
  'chat:attachment': { mime: string; data: string }
  'voice:status': VoiceStatus
  'voice:installBinary': null
  'voice:downloadModel': null
  'voice:deleteModel': VoiceStatus
  'voice:cancel': null
  'voice:transcribe': { text: string; raw: string }
  /** Whether the system lets Clyde use the microphone (asks on macOS). */
  'voice:micAccess': boolean
  'metrics:dashboard': Dashboard
  'metrics:transcript': SessionTranscript
  'limits:list': ProfileLimits[]
  'limits:session': SessionLimitUsage[]
  'limits:history': LimitHistory
  'limits:refresh': ProfileLimits[]
  'limits:diagnose': LimitDiagnostic[]
  'pricing:list': PriceRow[]
  'pricing:save': PriceRow[]
  'pricing:delete': PriceRow[]
  'files:list': { files: string[]; truncated: boolean }
}

export interface EventPayloads {
  'workspace:changed': WorkspaceInfo | null
  'fs:changed': FsChange[]
  'pty:data': { id: string; data: string }
  'pty:exit': { id: string; exitCode: number }
  'profiles:changed': Profile[]
  'agent:session': AgentSessionInfo
  'agent:event': AgentEventEnvelope
  /** A session will be told to carry on at `at` (ms), or no longer (null). */
  'agent:resumeScheduled': { sessionId: string; at: number | null }
  'mcp:changed': McpServer[]
  'agents:changed': AgentDefinition[]
  'tasks:changed': Task[]
  'chat:changed': Conversation[]
  'chat:message': ChatMessage
  'chat:live': ChatLive
  'voice:progress': VoiceProgress
  'memory:changed': MemoryState
  'limits:changed': ProfileLimits
  'limits:sessionChanged': { sessionId: string; usage: SessionLimitUsage[] }
  'limits:alert': LimitAlert
}

export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof requestSchemas)[C]>
export type ParsedRequest<C extends InvokeChannel> = z.output<(typeof requestSchemas)[C]>

export type InvokeArgs<C extends InvokeChannel> =
  undefined extends InvokeRequest<C> ? [payload?: InvokeRequest<C>] : [payload: InvokeRequest<C>]

// Compile-time check that every event channel has a payload type.
export type _EventsCovered = Record<EventChannel, unknown> extends EventPayloads ? true : never
