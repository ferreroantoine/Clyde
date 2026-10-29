import { t } from '@shared/i18n'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { AppError } from '@shared/errors'
import type { McpImportPreview } from '@shared/mcp'
import { handle } from './router'
import type { McpHub } from '../mcp/hub'
import { claudeDesktopConfigPath, parseClaudeDesktopConfig } from '../mcp/import-claude-desktop'

export function registerMcpHandlers(hub: McpHub): void {
  // Import only reads the file the user picked in the dialog, never a path the renderer names.
  let picked: string | null = null

  const parse = async (path: string) => {
    try {
      return parseClaudeDesktopConfig(await readFile(path, 'utf8'))
    } catch (err) {
      throw new AppError('invalid_request', (err as Error).message)
    }
  }

  handle('mcp:list', () => hub.list())
  handle('mcp:create', (input) => hub.create(input))
  handle('mcp:update', (input) => hub.update(input))
  handle('mcp:delete', async ({ id }) => {
    await hub.delete(id)
    return null
  })
  handle('mcp:reconnect', async ({ id }) => {
    await hub.reconnect(id)
    return null
  })
  handle('mcp:importPreview', async (_req, event): Promise<McpImportPreview | null> => {
    const suggested = claudeDesktopConfigPath(process.platform)
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: t('Import MCP servers'),
      defaultPath: existsSync(suggested) ? suggested : dirname(suggested),
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const [path] = result.filePaths
    if (result.canceled || !path) return null
    const parsed = await parse(path)
    picked = path
    const existing = new Set(hub.list().map((s) => s.name.toLowerCase()))
    return {
      path,
      servers: parsed.servers.map(({ name, input }) => ({
        name,
        transport: input.transport,
        summary: input.transport === 'stdio' ? [input.command, ...(input.args ?? [])].join(' ') : input.url,
        envKeys: Object.keys((input.transport === 'stdio' ? input.env : input.headers) ?? {}),
        exists: existing.has(name.toLowerCase())
      })),
      skipped: parsed.skipped
    }
  })
  handle('mcp:import', async ({ path, names }) => {
    if (!picked || path !== picked) throw new AppError('forbidden', t('Pick the file again before importing'))
    const wanted = new Set(names)
    const parsed = await parse(path)
    let servers = hub.list()
    for (const { name, input } of parsed.servers) if (wanted.has(name)) servers = hub.create(input)
    picked = null
    return servers
  })
}
