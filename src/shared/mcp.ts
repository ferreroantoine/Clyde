import { z } from 'zod'

export const mcpIdSchema = z.uuid()

const name = z.string().trim().min(1, 'Name is required').max(60)
const keyValues = z.record(z.string().trim().min(1).max(200), z.string().max(10_000))

export const mcpServerInputSchema = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('stdio'),
    name,
    command: z.string().trim().min(1, 'Command is required').max(4096),
    args: z.array(z.string().max(4096)).max(100).default([]),
    /** Often holds tokens: stored encrypted, and only the keys go back to the renderer. */
    env: keyValues.default({}),
    enabled: z.boolean().default(true)
  }),
  z.object({
    transport: z.literal('http'),
    name,
    url: z.string().trim().regex(/^https?:\/\/\S+$/i, 'Enter an http:// or https:// URL'),
    headers: keyValues.default({}),
    enabled: z.boolean().default(true)
  })
])
export type McpServerInput = z.input<typeof mcpServerInputSchema>

export const mcpServerUpdateSchema = z.object({
  id: mcpIdSchema,
  name: name.optional(),
  command: z.string().trim().min(1).max(4096).optional(),
  args: z.array(z.string().max(4096)).max(100).optional(),
  url: z.string().trim().regex(/^https?:\/\/\S+$/i).optional(),
  /** Replaces the whole environment (or header set) when given. */
  env: keyValues.optional(),
  headers: keyValues.optional(),
  enabled: z.boolean().optional()
})
export type McpServerUpdate = z.input<typeof mcpServerUpdateSchema>

export type McpStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export interface McpTool {
  name: string
  /** `mcp__<server slug>__<tool>`, the name Claude Code uses and the one allow-lists store. */
  qualifiedName: string
  description: string
}

export interface McpServer {
  id: string
  name: string
  /** Stable identifier used in tool names. */
  slug: string
  transport: 'stdio' | 'http'
  command: string
  args: string[]
  url: string
  envKeys: string[]
  headerKeys: string[]
  enabled: boolean
  status: McpStatus
  error: string | null
  tools: McpTool[]
}

export interface McpImportCandidate {
  name: string
  transport: 'stdio' | 'http'
  /** Command line or URL, for the preview. */
  summary: string
  envKeys: string[]
  /** Set when a server with this name already exists. */
  exists: boolean
}

export interface McpImportPreview {
  path: string
  servers: McpImportCandidate[]
  skipped: Array<{ name: string; reason: string }>
}

export function qualifiedToolName(slug: string, tool: string): string {
  return `mcp__${slug}__${tool}`
}

/** Lowercase letters, digits, `_` and `-`, as tool names allow. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'server'
  )
}
