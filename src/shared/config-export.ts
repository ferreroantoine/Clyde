import { z } from 'zod'

/**
 * What "Export configuration" writes: settings, accounts, MCP servers, saved agents and the
 * prices the user entered. Never a secret: no API key, no MCP environment value or header
 * value (only their names), and command arguments go through redaction.
 */
export const CONFIG_FORMAT = 'clyde-config'

export const configExportSchema = z.object({
  format: z.literal(CONFIG_FORMAT),
  version: z.literal(1),
  exportedAt: z.number(),
  settings: z.record(z.string(), z.unknown()),
  profiles: z
    .array(
      z.object({
        kind: z.string(),
        name: z.string(),
        label: z.string().default(''),
        color: z.string(),
        auth: z.string(),
        defaultModel: z.string().default(''),
        baseUrl: z.string().default('')
      })
    )
    .default([]),
  mcpServers: z
    .array(
      z.object({
        name: z.string(),
        transport: z.enum(['stdio', 'http']),
        command: z.string().default(''),
        args: z.array(z.string()).default([]),
        url: z.string().default(''),
        envKeys: z.array(z.string()).default([]),
        headerKeys: z.array(z.string()).default([])
      })
    )
    .default([]),
  agents: z
    .array(
      z.object({
        name: z.string(),
        profileName: z.string(),
        model: z.string().default(''),
        systemPrompt: z.string().default(''),
        permissionLevel: z.string(),
        mcpTools: z.array(z.string()).default([])
      })
    )
    .default([]),
  prices: z
    .array(z.object({ kind: z.string(), modelPrefix: z.string(), inputPerMTok: z.number(), outputPerMTok: z.number() }))
    .default([])
})
export type ConfigExport = z.output<typeof configExportSchema>

export interface ImportSummary {
  settings: boolean
  profiles: number
  mcpServers: number
  agents: number
  prices: number
  /** What was left out, and why. */
  skipped: string[]
}

export interface DataPaths {
  userData: string
  database: string
  logs: string
}
