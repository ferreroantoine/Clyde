import { tk } from './i18n'
import type { WhisperModelId } from './settings'

/** A Whisper model Clyde can download. Sizes and SHA-256 are those Hugging Face serves. */
export interface WhisperModel {
  id: WhisperModelId
  label: string
  hint: string
  file: string
  size: number
  sha256: string
}

/** From the lightest to the most accurate. Files of huggingface.co/ggerganov/whisper.cpp. */
export const WHISPER_MODELS: WhisperModel[] = [
  { id: 'tiny', label: tk('Tiny'), hint: tk('Fastest, rough on accents'), file: 'ggml-tiny.bin', size: 77_691_713, sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21' },
  { id: 'base', label: tk('Base'), hint: tk('Fast, good for short dictation'), file: 'ggml-base.bin', size: 147_951_465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' },
  { id: 'small', label: tk('Small'), hint: tk('Accurate, a few seconds on a recent CPU'), file: 'ggml-small.bin', size: 487_601_967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b' },
  { id: 'medium', label: tk('Medium'), hint: tk('Very accurate, slow without a GPU'), file: 'ggml-medium.bin', size: 1_533_763_059, sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208' },
  { id: 'large-v3-turbo-q5_0', label: tk('Large v3 Turbo (compressed)'), hint: tk('Close to the best, half the size'), file: 'ggml-large-v3-turbo-q5_0.bin', size: 574_041_195, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2' },
  { id: 'large-v3-turbo', label: tk('Large v3 Turbo'), hint: tk('The most accurate; best with a GPU'), file: 'ggml-large-v3-turbo.bin', size: 1_624_555_275, sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69' }
]

export const WHISPER_MODEL_URL = (file: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`

export interface VoiceModelState {
  id: WhisperModelId
  size: number
  installed: boolean
}

export interface VoiceStatus {
  /** whisper-cli: where it is, and whether Clyde can download it on this platform. */
  binary: { path: string | null; source: 'custom' | 'downloaded' | 'path' | null; downloadable: boolean }
  models: VoiceModelState[]
}

export interface VoiceProgress {
  kind: 'binary' | 'model'
  id: string
  received: number
  total: number
  state: 'downloading' | 'done' | 'error' | 'cancelled'
  error?: string
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Removes hesitation words ("euh", "hum"…) and only them. A filler may be stretched ("euuuh")
 * or trail off ("euh…"); the commas that only framed it go with it ("pense, euh, que" →
 * "pense que"), and a sentence that started with it keeps its capital. Nothing else changes.
 */
export function removeHesitations(text: string, words: readonly string[]): string {
  const list = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))]
  if (list.length === 0 || !text) return text
  const alternatives = list
    .sort((a, b) => b.length - a.length)
    .map((w) => [...w].map((c) => `${escape(c)}+`).join(''))
    .join('|')
  const filler = new RegExp(`(?<![\\p{L}\\p{N}'’-])(?:${alternatives})(?![\\p{L}\\p{N}'’-])(?:\\s*(?:\\.\\.\\.|…))?`, 'giu')

  let out = text
  for (let match = filler.exec(out); match; match = filler.exec(out)) {
    let start = match.index
    let end = start + match[0].length
    const left = /[,;]\s*$/.exec(out.slice(0, start))
    const right = /^\s*,/.exec(out.slice(end))
    if (right) end += right[0].length
    if (left) start -= left[0].length
    const before = out.slice(0, start)
    const after = out.slice(end)
    // A filler that opened a sentence hands its capital to the next word.
    const opened = /(^|[.!?…]\s+)$/.test(before) && /^\p{Lu}/u.test(match[0])
    let rest = after.replace(/^\s+/, '')
    if (opened) rest = rest.replace(/^\p{Ll}/u, (c) => c.toUpperCase())
    const glue = before === '' || /\s$/.test(before) || /^[.,!?;:…)]/.test(rest) || rest === '' ? '' : ' '
    out = before + glue + rest
    filler.lastIndex = before.length
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '')
}

/** Inserts dictated text where the cursor is, with a space where the words would touch. */
export function insertDictation(value: string, start: number, end: number, text: string): { value: string; cursor: number } {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const clean = text.trim()
  if (!clean) return { value, cursor: start }
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^[\s.,!?;:]/.test(after) ? ' ' : ''
  const inserted = `${lead}${clean}${trail}`
  return { value: before + inserted + after, cursor: before.length + inserted.length }
}
