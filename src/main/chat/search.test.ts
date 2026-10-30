import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from '../services/db/database'
import { ChatSearch, chunkText, ollamaEmbed, passagesPrompt } from './search'

// A toy embedding: one dimension per keyword, enough to rank passages.
const WORDS = ['docker', 'pnpm', 'release', 'cake']
const embed = vi.fn(async (texts: string[]) => ({
  model: 'toy',
  vectors: texts.map((t) => WORDS.map((w) => (t.toLowerCase().includes(w) ? 1 : 0)))
}))

function setup() {
  const db = new Database(':memory:')
  migrate(db)
  const add = db.prepare(`INSERT INTO conversations (id, title, profile_id, created_at, updated_at) VALUES (?, ?, 'p', 0, 0)`)
  add.run('a', 'Docker setup')
  add.run('b', 'Baking')
  add.run('c', 'Current')
  return new ChatSearch(db, embed)
}

describe('ChatSearch', () => {
  it('chunks long text on paragraphs', () => {
    expect(chunkText('one\n\ntwo', 10)).toEqual(['one\n\ntwo'])
    expect(chunkText('aaaaaa\n\nbbbbbb', 10)).toEqual(['aaaaaa', 'bbbbbb'])
    expect(chunkText('x'.repeat(25), 10)).toHaveLength(3)
    expect(chunkText('  \n\n ')).toEqual([])
  })

  it('finds passages of other conversations only', async () => {
    const search = setup()
    await search.index('a', 'm1', 'Run docker compose up, then docker ps.')
    await search.index('b', 'm2', 'The cake needs 200 g of sugar.')
    await search.index('c', 'm3', 'We talked about docker here too.')
    const found = await search.search('How did I start docker?', 'c')
    expect(found.map((p) => p.conversationId)).toEqual(['a'])
    expect(found[0]?.title).toBe('Docker setup')
    expect(await search.search('unrelated question', 'c')).toEqual([])
    expect(passagesPrompt(found)).toContain('<passage conversation="Docker setup">')
    expect(passagesPrompt([])).toBe('')
  })

  it('calls the native Ollama endpoint even for a /v1 base URL', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ embeddings: [[1, 0]] })))
    const run = ollamaEmbed(fetch as unknown as typeof globalThis.fetch, () => 'http://gpu.lan:11434/v1/', () => 'nomic-embed-text')
    expect(await run(['hi'])).toEqual({ model: 'nomic-embed-text', vectors: [[1, 0]] })
    expect(fetch).toHaveBeenCalledWith('http://gpu.lan:11434/api/embed', expect.objectContaining({ method: 'POST' }))
    await expect(ollamaEmbed(fetch as unknown as typeof globalThis.fetch, () => null, () => 'm')(['x'])).rejects.toThrow()
  })
})
