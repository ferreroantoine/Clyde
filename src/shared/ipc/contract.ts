import { z } from 'zod'
import type { EventChannel, InvokeChannel } from './channels'
import type { Settings } from '../settings'
import { profileCreateSchema, profileIdSchema, profileUpdateSchema, type ConnectionResult, type Profile } from '../profiles'
import { mcpIdSchema, mcpServerInputSchema, mcpServerUpdateSchema, type McpImportPreview, type McpServer } from '../mcp'
import {
  agentStartSchema,
  approvalAnswerSchema,
  sessionIdSchema,
  type AgentEventEnvelope,
  type AgentSessionInfo
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
  'workspace:pick': z.undefined(),
  'workspace:open': z.object({ root: z.string().min(1).max(4096) }),
  'workspace:current': z.undefined(),
  'fs:list': z.object({ path: relPath }),
  'fs:read': z.object({ path: relPath }),
  'fs:write': z.object({ path: relPath, content: z.string() }),
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
  'settings:set': z.object({ key: z.string().min(1).max(128), value: z.unknown() }),
  'profiles:list': z.undefined(),
  'profiles:create': profileCreateSchema,
  'profiles:update': profileUpdateSchema,
  'profiles:delete': z.object({ id: profileIdSchema }),
  'profiles:test': z.object({ id: profileIdSchema }),
  'profiles:login': z.object({ id: profileIdSchema, ...dims }),
  'agent:list': z.undefined(),
  'agent:start': agentStartSchema,
  'agent:send': z.object({ sessionId: sessionIdSchema, text: z.string().trim().min(1).max(100_000) }),
  'agent:interrupt': z.object({ sessionId: sessionIdSchema }),
  'agent:stop': z.object({ sessionId: sessionIdSchema }),
  'agent:approve': approvalAnswerSchema,
  'mcp:list': z.undefined(),
  'mcp:create': mcpServerInputSchema,
  'mcp:update': mcpServerUpdateSchema,
  'mcp:delete': z.object({ id: mcpIdSchema }),
  'mcp:reconnect': z.object({ id: mcpIdSchema }),
  'mcp:importPreview': z.undefined(),
  'mcp:import': z.object({ path: z.string().min(1).max(4096), names: z.array(z.string().max(200)).max(200) })
} satisfies Record<InvokeChannel, z.ZodType>

export interface InvokeResponses {
  'app:getInfo': AppInfo
  'workspace:pick': WorkspaceInfo | null
  'workspace:open': WorkspaceInfo
  'workspace:current': WorkspaceInfo | null
  'fs:list': DirEntry[]
  'fs:read': FileContent
  'fs:write': { mtimeMs: number }
  'search:text': SearchResult
  'pty:create': PtyInfo
  'pty:write': null
  'pty:resize': null
  'pty:kill': null
  'settings:getAll': Settings
  'settings:set': Settings
  'profiles:list': Profile[]
  'profiles:create': Profile
  'profiles:update': Profile
  'profiles:delete': null
  'profiles:test': ConnectionResult
  'profiles:login': PtyInfo
  'agent:list': AgentSessionInfo[]
  'agent:start': AgentSessionInfo
  'agent:send': null
  'agent:interrupt': null
  'agent:stop': null
  'agent:approve': null
  'mcp:list': McpServer[]
  'mcp:create': McpServer[]
  'mcp:update': McpServer[]
  'mcp:delete': null
  'mcp:reconnect': null
  'mcp:importPreview': McpImportPreview | null
  'mcp:import': McpServer[]
}

export interface EventPayloads {
  'workspace:changed': WorkspaceInfo | null
  'fs:changed': FsChange[]
  'pty:data': { id: string; data: string }
  'pty:exit': { id: string; exitCode: number }
  'profiles:changed': Profile[]
  'agent:session': AgentSessionInfo
  'agent:event': AgentEventEnvelope
  'mcp:changed': McpServer[]
}

export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof requestSchemas)[C]>
export type ParsedRequest<C extends InvokeChannel> = z.output<(typeof requestSchemas)[C]>

export type InvokeArgs<C extends InvokeChannel> =
  undefined extends InvokeRequest<C> ? [payload?: InvokeRequest<C>] : [payload: InvokeRequest<C>]

// Compile-time check that every event channel has a payload type.
export type _EventsCovered = Record<EventChannel, unknown> extends EventPayloads ? true : never
