import { createHash } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import type { VoiceProgress } from '@shared/voice'

const run = promisify(execFile)

/**
 * whisper.cpp builds Atelier downloads. Upstream publishes binaries on its `b<build>` releases
 * (the `v1.9.x` tags carry source only); these are pinned with their SHA-256, measured on
 * release b5454 (whisper.cpp 1.9.5). There is no official macOS binary (Homebrew has one) and
 * no official Windows Vulkan build: a whisper-cli built with Vulkan can be set in Settings.
 */
export interface WhisperBuild {
  url: string
  sha256: string
  /** Where whisper-cli is inside the archive. */
  exe: string
}

const RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454'

export const WHISPER_BUILDS: Partial<Record<string, WhisperBuild>> = {
  'win32-x64': {
    url: `${RELEASE}/whisper-bin-x64.zip`,
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
    exe: 'Release/whisper-cli.exe'
  },
  'linux-x64': {
    url: `${RELEASE}/whisper-bin-ubuntu-x64.tar.gz`,
    sha256: 'a72becf15d7917f990f6313867a52638b82b7f9ef237fb0c980dac56a135781c',
    exe: 'whisper-bin-ubuntu-x64/whisper-cli'
  }
}

export function buildFor(platform: NodeJS.Platform, arch: string): WhisperBuild | null {
  return WHISPER_BUILDS[`${platform}-${arch}`] ?? null
}

export type Progress = (p: Omit<VoiceProgress, 'kind' | 'id'>) => void

/**
 * Downloads a file next to `dest`, checks its SHA-256, then moves it in place. Progress is
 * reported at most every 200 ms; a wrong checksum deletes the file.
 */
export async function download(
  fetch: typeof globalThis.fetch,
  url: string,
  dest: string,
  sha256: string,
  signal: AbortSignal,
  progress: Progress
): Promise<void> {
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) throw new AppError('io_error', t('Download failed ({status})', { status: response.status }))
  const total = Number(response.headers.get('content-length')) || 0
  const part = `${dest}.part`
  const hash = createHash('sha256')
  let received = 0
  let last = 0
  const body = Readable.fromWeb(response.body as WebReadableStream)
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    received += chunk.length
    const now = Date.now()
    if (now - last > 200) {
      last = now
      progress({ received, total, state: 'downloading' })
    }
  })
  try {
    await pipeline(body, createWriteStream(part), { signal })
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  }
  if (hash.digest('hex') !== sha256) {
    rmSync(part, { force: true })
    throw new AppError('io_error', t('The downloaded file is not the expected one (checksum mismatch).'))
  }
  renameSync(part, dest)
  progress({ received, total: total || received, state: 'downloading' })
}

/**
 * Unpacks the build with the system's `tar`: GNU tar for .tar.gz, and on Windows the bsdtar
 * that ships with Windows 10 and later, which also reads .zip.
 */
export async function extract(archive: string, dir: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const tar = platform === 'win32' ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  await run(tar, ['-xf', archive, '-C', dir])
  if (platform !== 'win32') {
    for (const file of walk(dir)) {
      if (!/\.(so(\.\d+)*|txt|md)$/.test(file) && !file.endsWith('LICENSE')) chmodSync(file, 0o755)
    }
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

export function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0
}
