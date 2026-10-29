import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import OpenAI, { toFile } from 'openai'
import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import type { Settings, WhisperModelId } from '@shared/settings'
import type { Profile } from '@shared/profiles'
import { WHISPER_MODELS, WHISPER_MODEL_URL, removeHesitations, type VoiceProgress, type VoiceStatus } from '@shared/voice'
import { GEMINI_OPENAI_URL, type ApiTarget } from '../agents/api/clients'
import type { ChatAdapter } from '../agents/api/chat'
import { buildFor, download, extract, fileSize, type WhisperBuild } from './install'

export interface VoiceServiceDeps {
  /** `userData/whisper`: `bin/` for whisper.cpp, `models/` for the ggml files. */
  root: string
  settings: () => Settings['voice']
  profiles: () => Profile[]
  apiKey: (profileId: string) => string | null
  fetch: typeof globalThis.fetch
  createAdapter: (target: ApiTarget) => ChatAdapter
  onProgress: (progress: VoiceProgress) => void
  platform?: NodeJS.Platform
  arch?: string
  env?: NodeJS.ProcessEnv
  /** Runs whisper-cli; swapped in tests. */
  exec?: (file: string, args: string[]) => Promise<string>
}

/** Bracketed or parenthesized non-speech whisper adds: [BLANK_AUDIO], (music), [Applause]… */
const NON_SPEECH = /\s*[[(][^\])]{1,40}[\])]\s*/g

const REWRITE_SYSTEM = [
  'You clean up dictated text. Fix punctuation and capitalization, remove repeated words and false starts.',
  'Keep the meaning, the language, the wording and the order. Do not answer, comment or add anything.',
  'Reply with the cleaned text only.'
].join(' ')

/**
 * Dictation: whisper.cpp on this machine by default (the audio never leaves it), or the
 * transcription of an OpenAI or Gemini account. Then the optional clean-up passes.
 */
export class VoiceService {
  private readonly downloads = new Map<string, AbortController>()

  constructor(private readonly deps: VoiceServiceDeps) {}

  status(): VoiceStatus {
    const build = this.build()
    const custom = this.deps.settings().whisperPath.trim()
    const downloaded = build ? this.downloadedExe(build) : null
    const onPath = this.findOnPath()
    const path = custom || (downloaded && existsSync(downloaded) ? downloaded : null) || onPath
    return {
      binary: {
        path,
        source: custom ? 'custom' : downloaded && path === downloaded ? 'downloaded' : path ? 'path' : null,
        downloadable: !!build
      },
      models: WHISPER_MODELS.map((m) => ({ id: m.id, size: m.size, installed: fileSize(this.modelPath(m.id)) === m.size }))
    }
  }

  async installBinary(): Promise<void> {
    const build = this.build()
    if (!build) throw new AppError('not_allowed', t('Atelier cannot download whisper.cpp for this system. Install it (on macOS: brew install whisper-cpp) or set its path.'))
    const bin = join(this.deps.root, 'bin')
    mkdirSync(this.deps.root, { recursive: true })
    const archive = join(this.deps.root, build.url.endsWith('.zip') ? 'whisper.zip' : 'whisper.tar.gz')
    await this.track('binary', 'whisper-cli', async (signal, progress) => {
      await download(this.deps.fetch, build.url, archive, build.sha256, signal, progress)
      await extract(archive, bin, this.platform())
      rmSync(archive, { force: true })
    })
  }

  async downloadModel(id: WhisperModelId): Promise<void> {
    const model = WHISPER_MODELS.find((m) => m.id === id)
    if (!model) throw new AppError('not_found', t('Unknown model'))
    mkdirSync(join(this.deps.root, 'models'), { recursive: true })
    await this.track('model', id, (signal, progress) => download(this.deps.fetch, WHISPER_MODEL_URL(model.file), this.modelPath(id), model.sha256, signal, progress))
  }

  deleteModel(id: WhisperModelId): VoiceStatus {
    rmSync(this.modelPath(id), { force: true })
    return this.status()
  }

  cancel(id: string): void {
    this.downloads.get(id)?.abort()
  }

  /** Turns a 16 kHz mono WAV into text, cleaned as Settings › Voice says. */
  async transcribe(wav: Buffer): Promise<{ text: string; raw: string }> {
    const voice = this.deps.settings()
    const raw = voice.engine === 'api' ? await this.transcribeApi(wav) : await this.transcribeLocal(wav)
    let text = raw.replace(NON_SPEECH, ' ').replace(/\s+/g, ' ').trim()
    if (voice.removeHesitations) text = removeHesitations(text, voice.hesitations)
    if (voice.rewrite && text) text = await this.rewrite(text)
    return { text, raw }
  }

  private async transcribeLocal(wav: Buffer): Promise<string> {
    const voice = this.deps.settings()
    const exe = this.status().binary.path
    if (!exe) throw new AppError('not_found', t('whisper.cpp is not installed. Download it in Settings › Voice.'))
    const model = this.modelPath(voice.model)
    if (!existsSync(model)) throw new AppError('not_found', t('The {model} model is not downloaded. Download it in Settings › Voice.', { model: voice.model }))
    const file = join(tmpdir(), `atelier-dictation-${randomUUID()}.wav`)
    writeFileSync(file, wav)
    try {
      const args = ['-m', model, '-f', file, '-l', voice.language, '-nt', '-np', '-t', String(Math.max(1, Math.min(8, cpus().length)))]
      if (!voice.useGpu) args.push('-ng')
      return await (this.deps.exec ?? execText)(exe, args)
    } finally {
      rmSync(file, { force: true })
    }
  }

  /** OpenAI's transcription endpoint, or Gemini reading the audio through its OpenAI-compatible chat. */
  private async transcribeApi(wav: Buffer): Promise<string> {
    const voice = this.deps.settings()
    const profile = this.deps.profiles().find((p) => p.id === voice.apiProfileId && (p.kind === 'openai' || p.kind === 'gemini'))
    if (!profile) throw new AppError('invalid_request', t('Choose an OpenAI or Gemini account for dictation in Settings › Voice.'))
    const apiKey = this.deps.apiKey(profile.id)
    if (!apiKey) throw new AppError('invalid_request', t('This account has no API key'))
    const common = { apiKey, fetch: this.deps.fetch, maxRetries: 1, timeout: 120_000, organization: null, project: null }
    if (profile.kind === 'openai') {
      const client = new OpenAI({ ...common, baseURL: 'https://api.openai.com/v1' })
      const result = await client.audio.transcriptions.create({
        file: await toFile(wav, 'dictation.wav', { type: 'audio/wav' }),
        model: 'gpt-4o-mini-transcribe',
        ...(voice.language === 'auto' ? {} : { language: voice.language })
      })
      return result.text
    }
    const client = new OpenAI({ ...common, baseURL: GEMINI_OPENAI_URL })
    const completion = await client.chat.completions.create({
      model: profile.defaultModel || 'gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe this audio verbatim, in the language spoken. Reply with the transcript only.' },
            { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }
          ]
        }
      ]
    })
    return completion.choices[0]?.message.content ?? ''
  }

  /** A light model fixes punctuation, repetitions and false starts; an Ollama account by default. */
  private async rewrite(text: string): Promise<string> {
    const voice = this.deps.settings()
    const profiles = this.deps.profiles().filter((p) => p.usable)
    const profile = profiles.find((p) => p.id === voice.rewriteProfileId) ?? profiles.find((p) => p.kind === 'ollama')
    if (!profile || (profile.kind !== 'ollama' && profile.kind !== 'openai' && profile.kind !== 'anthropic' && profile.kind !== 'gemini')) {
      throw new AppError('invalid_request', t('Rewriting needs an Ollama or API account. Add one, or turn the option off in Settings › Voice.'))
    }
    const adapter = this.deps.createAdapter({ kind: profile.kind, apiKey: this.deps.apiKey(profile.id), baseUrl: profile.baseUrl })
    const model = profile.defaultModel || (await adapter.listModels())[0]?.value
    if (!model) throw new AppError('invalid_request', t('This account lists no model. Choose one by name.'))
    let out = ''
    for await (const event of adapter.stream({
      model,
      system: REWRITE_SYSTEM,
      messages: [{ role: 'user', text }],
      tools: [],
      signal: AbortSignal.timeout(60_000)
    })) {
      if (event.type === 'done') out = event.text
    }
    return out.trim() || text
  }

  private async track(kind: VoiceProgress['kind'], id: string, work: (signal: AbortSignal, progress: (p: Omit<VoiceProgress, 'kind' | 'id'>) => void) => Promise<void>): Promise<void> {
    if (this.downloads.has(id)) return
    const controller = new AbortController()
    this.downloads.set(id, controller)
    const progress = (p: Omit<VoiceProgress, 'kind' | 'id'>) => this.deps.onProgress({ kind, id, ...p })
    progress({ received: 0, total: 0, state: 'downloading' })
    try {
      await work(controller.signal, progress)
      progress({ received: 1, total: 1, state: 'done' })
    } catch (err) {
      const cancelled = controller.signal.aborted
      progress({ received: 0, total: 0, state: cancelled ? 'cancelled' : 'error', ...(cancelled ? {} : { error: (err as Error).message }) })
      if (!cancelled) throw err
    } finally {
      this.downloads.delete(id)
    }
  }

  private build(): WhisperBuild | null {
    return buildFor(this.platform(), this.deps.arch ?? process.arch)
  }

  private downloadedExe(build: WhisperBuild): string {
    return join(this.deps.root, 'bin', ...build.exe.split('/'))
  }

  modelPath(id: WhisperModelId): string {
    const model = WHISPER_MODELS.find((m) => m.id === id)
    return join(this.deps.root, 'models', model?.file ?? `ggml-${id}.bin`)
  }

  private findOnPath(): string | null {
    const env = this.deps.env ?? process.env
    const exe = this.platform() === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
    const dirs = [...(env['PATH'] ?? env['Path'] ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean)
    for (const dir of dirs) {
      const candidate = join(dir, exe)
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  private platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform
  }
}

function execText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new AppError('agent_error', t('whisper.cpp failed: {message}', { message: (stderr || err.message).trim().split('\n').at(-1) ?? '' })))
      else resolve(stdout)
    })
  })
}
