import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fileHandler, mimeOf, parseRange, pathOfUrl, replyFor } from './file-protocol'

const base = mkdtempSync(join(tmpdir(), 'clyde-fileproto-'))
const root = join(base, 'project')
mkdirSync(join(root, 'img dir'), { recursive: true })
writeFileSync(join(root, 'img dir', 'é 1.png'), Buffer.from('0123456789'))
writeFileSync(join(base, 'secret.txt'), 'outside')
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('pathOfUrl', () => {
  it('decodes each part of the path', () => {
    expect(pathOfUrl('clyde-file://workspace/img%20dir/%C3%A9%201.png?v=3')).toBe('img dir/é 1.png')
  })

  it('refuses other schemes and hosts', () => {
    expect(pathOfUrl('file:///C:/x.png')).toBeNull()
    expect(pathOfUrl('clyde-file://other/x.png')).toBeNull()
    expect(pathOfUrl('clyde-file://workspace/%E0%A4%A')).toBeNull()
  })
})

describe('parseRange', () => {
  it('reads the three forms', () => {
    expect(parseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(parseRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 })
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
    expect(parseRange('bytes=4-100', 10)).toEqual({ start: 4, end: 9 })
  })

  it('tells unusable from unsatisfiable', () => {
    expect(parseRange(null, 10)).toBeNull()
    expect(parseRange('items=1-2', 10)).toBeNull()
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable')
    expect(parseRange('bytes=5-2', 10)).toBe('unsatisfiable')
  })
})

describe('replyFor', () => {
  const url = 'clyde-file://workspace/img%20dir/%C3%A9%201.png'

  it('serves a file of the folder whole', async () => {
    const reply = await replyFor(root, url, 'GET', null)
    expect(reply.status).toBe(200)
    expect(reply.headers['content-type']).toBe('image/png')
    expect(reply.headers['content-length']).toBe('10')
    expect(reply.body).toMatchObject({ start: 0, end: 9 })
  })

  it('answers ranges with 206 and 416', async () => {
    const part = await replyFor(root, url, 'GET', 'bytes=2-4')
    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe('bytes 2-4/10')
    expect(part.headers['content-length']).toBe('3')
    expect((await replyFor(root, url, 'GET', 'bytes=20-')).status).toBe(416)
  })

  it('refuses paths outside the folder, and serves nothing without one', async () => {
    expect((await replyFor(root, 'clyde-file://workspace/..%2Fsecret.txt', 'GET', null)).status).toBe(403)
    expect((await replyFor(root, 'clyde-file://workspace/missing.png', 'GET', null)).status).toBe(404)
    expect((await replyFor(null, url, 'GET', null)).status).toBe(404)
  })

  it('streams the asked bytes', async () => {
    const response = await fileHandler(() => root)(new Request(url, { headers: { range: 'bytes=3-6' } }))
    expect(response.status).toBe(206)
    expect(await response.text()).toBe('3456')
  })
})

describe('mimeOf', () => {
  it('knows the viewers formats and falls back to bytes', () => {
    expect(mimeOf('a/B.PDF')).toBe('application/pdf')
    expect(mimeOf('song.flac')).toBe('audio/flac')
    expect(mimeOf('x.bin')).toBe('application/octet-stream')
  })
})

describe('CORS', () => {
  it('lets the file:// page fetch, preflight included', async () => {
    const reply = await replyFor(root, 'clyde-file://workspace/img%20dir/%C3%A9%201.png', 'GET', null)
    expect(reply.headers['access-control-allow-origin']).toBe('*')
    const preflight = await replyFor(root, 'clyde-file://workspace/x', 'OPTIONS', null)
    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-headers']).toBe('range')
  })
})
