import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { TodoItem } from '@shared/agent'
import { parseTodoList, todosReceipt, UPDATE_TODOS, UPDATE_TODOS_DESCRIPTION, UPDATE_TODOS_SCHEMA } from '../agents/todos'
import type { AgentMcpServer } from './hub'

export const CLYDE_SERVER_SLUG = 'clyde'
const MAX_BODY = 1024 * 1024

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(text ? JSON.parse(text) : undefined)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Clyde's own MCP server, for agents with no task-list tool of their own (Antigravity, Claude Code):
 * `update_todos` reaches the Tasks view. Streamable HTTP on 127.0.0.1, one random token per
 * session in the URL, so a call is always tied to the session it was given to.
 */
export class ClydeMcpServer {
  private http: HttpServer | null = null
  private port = 0
  private readonly tokens = new Map<string, string>()

  constructor(private readonly onTodos: (sessionId: string, items: TodoItem[]) => void) {}

  async start(): Promise<void> {
    if (this.http) return
    const http = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500).end()
      })
    })
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(0, '127.0.0.1', () => resolve())
    })
    this.port = (http.address() as AddressInfo).port
    this.http = http
  }

  async stop(): Promise<void> {
    const http = this.http
    this.http = null
    this.tokens.clear()
    if (http) await new Promise<void>((resolve) => http.close(() => resolve()))
  }

  /** The server as one agent's configuration sees it; null until `start` resolved. */
  serverFor(sessionId: string): AgentMcpServer | null {
    if (!this.http) return null
    let token = [...this.tokens].find(([, id]) => id === sessionId)?.[0]
    if (!token) {
      token = randomBytes(24).toString('hex')
      this.tokens.set(token, sessionId)
    }
    return { slug: CLYDE_SERVER_SLUG, tools: [UPDATE_TODOS], transport: 'http', url: `http://127.0.0.1:${this.port}/mcp/${token}`, headers: {} }
  }

  release(sessionId: string): void {
    for (const [token, id] of this.tokens) if (id === sessionId) this.tokens.delete(token)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = /^\/mcp\/([a-f0-9]{48})$/.exec(req.url ?? '')?.[1]
    const sessionId = token ? this.tokens.get(token) : undefined
    if (!sessionId) {
      res.writeHead(404).end()
      return
    }
    if (req.method !== 'POST') {
      // Stateless: no server-sent stream to resume, no session to end.
      res.writeHead(405, { allow: 'POST' }).end()
      return
    }
    const body = await readBody(req)
    const server = this.mcpServer(sessionId)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  private mcpServer(sessionId: string): Server {
    const server = new Server({ name: 'clyde', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [{ name: UPDATE_TODOS, description: UPDATE_TODOS_DESCRIPTION, inputSchema: UPDATE_TODOS_SCHEMA as unknown as { type: 'object' } }]
    }))
    server.setRequestHandler(CallToolRequestSchema, (request) => {
      if (request.params.name !== UPDATE_TODOS) {
        return { content: [{ type: 'text', text: `Unknown tool ${request.params.name}` }], isError: true }
      }
      const items = parseTodoList((request.params.arguments ?? {})['todos'])
      if (!items) return { content: [{ type: 'text', text: 'Give "todos": the whole list, each with text and status.' }], isError: true }
      this.onTodos(sessionId, items)
      return { content: [{ type: 'text', text: todosReceipt(items) }] }
    })
    return server
  }
}
