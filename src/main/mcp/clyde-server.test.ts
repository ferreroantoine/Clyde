import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { TodoItem } from '@shared/agent'
import { todosReceipt } from '../agents/todos'
import { ClydeMcpServer } from './clyde-server'

let server: ClydeMcpServer | null = null
afterEach(async () => {
  await server?.stop()
  server = null
})

async function connect(url: string) {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  return client
}

describe('ClydeMcpServer', () => {
  it('gives each session its URL and passes update_todos on to it', async () => {
    const received: Array<[string, TodoItem[]]> = []
    server = new ClydeMcpServer((id, items) => received.push([id, items]))
    expect(server.serverFor('as-1')).toBeNull()
    await server.start()
    const config = server.serverFor('as-1')
    expect(config).toMatchObject({ slug: 'clyde', tools: ['update_todos'], transport: 'http' })
    if (config?.transport !== 'http') throw new Error('expected http')
    // The same session keeps its URL.
    expect(server.serverFor('as-1')).toEqual(config)

    const client = await connect(config.url)
    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name)).toEqual(['update_todos'])
    const result = await client.callTool({ name: 'update_todos', arguments: { todos: [{ id: '1', text: 'Plan', status: 'in_progress', active: 'Planning' }] } })
    expect(result.isError).toBeFalsy()
    expect(received).toEqual([['as-1', [{ key: '1', text: 'Plan', status: 'in_progress', active: 'Planning' }]]])
    await client.close()
  })

  it('refuses unknown and released tokens', async () => {
    server = new ClydeMcpServer(() => undefined)
    await server.start()
    const config = server.serverFor('as-2')
    if (config?.transport !== 'http') throw new Error('expected http')
    server.release('as-2')
    expect((await fetch(config.url, { method: 'POST', body: '{}' })).status).toBe(404)
    expect((await fetch(config.url.replace(/[a-f0-9]{48}$/, 'f'.repeat(48)), { method: 'POST', body: '{}' })).status).toBe(404)
  })
})

describe('todosReceipt', () => {
  it('sums the list up', () => {
    expect(
      todosReceipt([
        { text: 'A', status: 'completed' },
        { text: 'B', status: 'in_progress' }
      ])
    ).toBe('Task list updated: 1/2 done, in progress: B.')
  })
})
