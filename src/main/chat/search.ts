import type { Db } from '../services/db/database'

/**
 * "Use my past conversations": passages of earlier chats, embedded by a local model
 * (Ollama's /api/embed) and stored in SQLite as float32 blobs. The search is a plain cosine
 * scan, which stays fast for the few thousand passages a person accumulates, and needs no
 * native SQLite extension to ship with the app.
 */
export type Embed = (texts: string[]) => Promise<{ model: string; vectors: number[][] }>

export interface Passage {
  conversationId: string
  title: string
  text: string
  score: number
}

const CHUNK = 1_200

/** Splits a message into passages of about CHUNK characters, on paragraph boundaries when it can. */
export function chunkText(text: string, size = CHUNK): string[] {
  const out: string[] = []
  let current = ''
  for (const paragraph of text.split(/\n{2,}/)) {
    const p = paragraph.trim()
    if (!p) continue
    if (current && current.length + p.length + 2 > size) {
      out.push(current)
      current = ''
    }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size))
    } else current = current ? `${current}\n\n${p}` : p
  }
  if (current) out.push(current)
  return out
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] as number
    const y = b[i] as number
    dot += x * y
    na += x * x
    nb += y * y
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const toBlob = (v: number[]) => Buffer.from(new Float32Array(v).buffer)
const fromBlob = (b: Buffer) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)

export class ChatSearch {
  constructor(
    private readonly db: Db,
    private readonly embed: Embed
  ) {}

  /** Indexes one message (an exchange is indexed as its two messages). */
  async index(conversationId: string, messageId: string, text: string): Promise<void> {
    const chunks = chunkText(text)
    if (chunks.length === 0) return
    const { model, vectors } = await this.embed(chunks)
    const insert = this.db.prepare('INSERT INTO chat_chunks (conversation_id, message_id, text, model, embedding) VALUES (?, ?, ?, ?, ?)')
    this.db.transaction(() => {
      chunks.forEach((chunk, i) => {
        const vector = vectors[i]
        if (vector) insert.run(conversationId, messageId, chunk, model, toBlob(vector))
      })
    })()
  }

  /** The best passages of other conversations for this text, above a relevance floor. */
  async search(query: string, excludeConversation: string, limit = 3, floor = 0.55): Promise<Passage[]> {
    const { model, vectors } = await this.embed([query.slice(0, 4_000)])
    const q = vectors[0]
    if (!q) return []
    const rows = this.db
      .prepare(
        `SELECT c.conversation_id, c.text, c.embedding, v.title FROM chat_chunks c JOIN conversations v ON v.id = c.conversation_id
         WHERE c.model = ? AND c.conversation_id != ?`
      )
      .all(model, excludeConversation) as Array<{ conversation_id: string; text: string; embedding: Buffer; title: string }>
    return rows
      .map((r) => ({ conversationId: r.conversation_id, title: r.title, text: r.text, score: cosine(q, fromBlob(r.embedding)) }))
      .filter((p) => p.score >= floor)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}

/** Ollama's embedding endpoint (POST /api/embed, `{ model, input }` → `{ embeddings }`). */
export function ollamaEmbed(fetch: typeof globalThis.fetch, baseUrl: () => string | null, model: () => string): Embed {
  return async (texts) => {
    const base = baseUrl()
    if (!base) throw new Error('No Ollama account for embeddings')
    // An Ollama account may point at its OpenAI-compatible /v1; the native API sits at the root.
    const root = base.replace(/\/+$/, '').replace(/\/v1$/, '')
    const response = await fetch(`${root}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: model(), input: texts })
    })
    if (!response.ok) throw new Error(`Ollama embeddings: HTTP ${response.status}`)
    const data = (await response.json()) as { embeddings?: number[][] }
    return { model: model(), vectors: data.embeddings ?? [] }
  }
}

/** The passages as context before the user's message. */
export function passagesPrompt(passages: readonly Passage[]): string {
  if (passages.length === 0) return ''
  return [
    'Passages from the user’s earlier conversations that may be relevant (use them only if they help):',
    ...passages.map((p) => `<passage conversation="${p.title.replace(/"/g, "'")}">\n${p.text}\n</passage>`)
  ].join('\n')
}
