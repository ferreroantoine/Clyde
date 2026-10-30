import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_HESITATIONS, settingsSchema, type Settings } from '@shared/settings'
import { insertDictation, removeHesitations, type VoiceProgress } from '@shared/voice'
import { VoiceService } from './service'
import { buildFor, download, extract } from './install'

const clean = (text: string) => removeHesitations(text, DEFAULT_HESITATIONS)

describe('removeHesitations', () => {
  it('removes fillers and the commas that framed them', () => {
    expect(clean('Je pense, euh, que oui.')).toBe('Je pense que oui.')
    expect(clean("C'est euh euh compliqué.")).toBe("C'est compliqué.")
    expect(clean('Je ne sais pas, hum.')).toBe('Je ne sais pas.')
    expect(clean('Alors euh… on y va')).toBe('Alors on y va')
    expect(clean('So, um, I think, uh, yes')).toBe('So I think yes')
  })

  it('hands the capital of a sentence-opening filler to the next word', () => {
    expect(clean('Euh, je pense que oui.')).toBe('Je pense que oui.')
    expect(clean('Bon. Hum... d’accord.')).toBe('Bon. D’accord.')
    expect(clean('Euh')).toBe('')
  })

  it('catches stretched fillers and any case', () => {
    expect(clean('Euuuh on verra, HUMMM, demain')).toBe('On verra demain')
    expect(clean('bahhh oui')).toBe('oui')
  })

  it('never touches words that only contain a filler', () => {
    const text = "Une heure, un humain, un bahut, l'humour, Benoît et le rhum."
    expect(clean(text)).toBe(text)
    expect(clean('Le mot « euh-bien » reste.')).toBe('Le mot « euh-bien » reste.')
  })

  it('uses the edited list only', () => {
    expect(removeHesitations('genre tu vois, euh, voilà', ['genre'])).toBe('tu vois, euh, voilà')
    expect(removeHesitations('euh rien', [])).toBe('euh rien')
  })
})

describe('insertDictation', () => {
  it('inserts at the cursor with spaces where words would touch', () => {
    expect(insertDictation('Bonjour monde', 7, 7, 'le')).toEqual({ value: 'Bonjour le monde', cursor: 10 })
    expect(insertDictation('', 0, 0, ' Salut ')).toEqual({ value: 'Salut', cursor: 5 })
    expect(insertDictation('Fin.', 3, 3, 'de phrase')).toEqual({ value: 'Fin de phrase.', cursor: 13 })
    expect(insertDictation('remplace ça', 9, 11, 'ceci')).toEqual({ value: 'remplace ceci', cursor: 13 })
    expect(insertDictation('abc', 1, 1, '   ')).toEqual({ value: 'abc', cursor: 1 })
  })
})

describe('VoiceService', () => {
  const setup = (voice: Partial<Settings['voice']> = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'clyde-voice-'))
    const calls: Array<{ file: string; args: string[] }> = []
    const progress: VoiceProgress[] = []
    const settings = { ...settingsSchema.parse({}).voice, ...voice }
    const service = new VoiceService({
      root,
      settings: () => settings,
      profiles: () => [],
      apiKey: () => null,
      fetch: globalThis.fetch,
      createAdapter: () => {
        throw new Error('no adapter in tests')
      },
      onProgress: (p) => progress.push(p),
      platform: 'linux',
      arch: 'x64',
      env: { PATH: '' },
      exec: async (file, args) => {
        calls.push({ file, args })
        return ' Euh, [BLANK_AUDIO] je pense, euh, que oui.\n'
      }
    })
    return { root, service, calls, progress, settings }
  }

  it('reports what is installed and where whisper-cli comes from', () => {
    const h = setup()
    expect(h.service.status()).toMatchObject({ binary: { path: null, source: null, downloadable: true } })
    expect(h.service.status().models.every((m) => !m.installed)).toBe(true)
    const exe = join(h.root, 'bin', 'whisper-bin-ubuntu-x64', 'whisper-cli')
    mkdirSync(dirname(exe), { recursive: true })
    writeFileSync(exe, '')
    expect(h.service.status().binary).toMatchObject({ path: exe, source: 'downloaded' })
    h.settings.whisperPath = '/opt/custom/whisper-cli'
    expect(h.service.status().binary).toMatchObject({ path: '/opt/custom/whisper-cli', source: 'custom' })
  })

  it('runs whisper-cli with the model and language, then cleans the text', async () => {
    const h = setup({ whisperPath: '/bin/whisper-cli', model: 'tiny', language: 'fr', useGpu: false })
    await expect(h.service.transcribe(Buffer.from('RIFF'))).rejects.toThrow(/not downloaded/)
    const model = h.service.modelPath('tiny')
    mkdirSync(dirname(model), { recursive: true })
    writeFileSync(model, '')
    const result = await h.service.transcribe(Buffer.from('RIFF'))
    expect(result.text).toBe('Je pense que oui.')
    const call = h.calls[0]
    expect(call?.file).toBe('/bin/whisper-cli')
    expect(call?.args).toEqual(expect.arrayContaining(['-m', model, '-l', 'fr', '-nt', '-np', '-ng']))
    // The temporary WAV is gone once whisper ran.
    const wav = call?.args[call.args.indexOf('-f') + 1] as string
    expect(existsSync(wav)).toBe(false)
  })

  it('keeps the raw text when hesitations should stay', async () => {
    const h = setup({ whisperPath: '/bin/whisper-cli', model: 'tiny', removeHesitations: false })
    const model = h.service.modelPath('tiny')
    mkdirSync(dirname(model), { recursive: true })
    writeFileSync(model, '')
    expect((await h.service.transcribe(Buffer.from('RIFF'))).text).toBe('Euh, je pense, euh, que oui.')
  })
})

describe('download and extract', () => {
  const serve = (body: Buffer) =>
    (async () => new Response(new Blob([new Uint8Array(body)]), { headers: { 'content-length': String(body.length) } })) as unknown as typeof globalThis.fetch

  it('checks the SHA-256 and moves the file in place', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clyde-dl-'))
    const body = Buffer.from('model bytes')
    const sha = createHash('sha256').update(body).digest('hex')
    const states: string[] = []
    await download(serve(body), 'https://x/model.bin', join(dir, 'model.bin'), sha, new AbortController().signal, (p) => states.push(p.state))
    expect(readFileSync(join(dir, 'model.bin'), 'utf8')).toBe('model bytes')
    expect(states.at(-1)).toBe('downloading')
    await expect(download(serve(body), 'https://x/bad.bin', join(dir, 'bad.bin'), 'f'.repeat(64), new AbortController().signal, () => undefined)).rejects.toThrow(/checksum/)
    expect(existsSync(join(dir, 'bad.bin'))).toBe(false)
    expect(existsSync(join(dir, 'bad.bin.part'))).toBe(false)
  })

  it('unpacks a tar.gz and makes the programs executable', async () => {
    const src = mkdtempSync(join(tmpdir(), 'clyde-tar-'))
    mkdirSync(join(src, 'whisper-bin-ubuntu-x64'))
    writeFileSync(join(src, 'whisper-bin-ubuntu-x64', 'whisper-cli'), '#!/bin/sh\necho hi\n')
    const archive = join(src, 'w.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', src, 'whisper-bin-ubuntu-x64'])
    const out = join(src, 'bin')
    await extract(archive, out, 'linux')
    const exe = join(out, 'whisper-bin-ubuntu-x64', 'whisper-cli')
    // Windows has no executable bit: there, the file only has to be there.
    if (process.platform === 'win32') expect(existsSync(exe)).toBe(true)
    else expect(statSync(exe).mode & 0o111).not.toBe(0)
    expect(buildFor('linux', 'x64')?.exe).toBe('whisper-bin-ubuntu-x64/whisper-cli')
    expect(buildFor('darwin', 'arm64')).toBeNull()
  })
})
