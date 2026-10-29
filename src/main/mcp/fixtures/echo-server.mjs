// Minimal stdio MCP server for tests and smoke runs: `echo`, `add` and `whoami` (reads env).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import process from 'node:process'
import { z } from 'zod'

const server = new McpServer({ name: 'echo', version: '1.0.0' })
server.registerTool(
  'echo',
  { description: 'Echo the text back', inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] })
)
server.registerTool(
  'add',
  { description: 'Add two numbers', inputSchema: { a: z.number(), b: z.number() } },
  async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] })
)
server.registerTool('whoami', { description: 'Report ECHO_USER from the environment' }, async () => ({
  content: [{ type: 'text', text: process.env.ECHO_USER ?? '(unset)' }],
  isError: !process.env.ECHO_USER
}))
await server.connect(new StdioServerTransport())
