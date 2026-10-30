import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { WhisperModelId } from '@shared/settings'
import { insertDictation, type VoiceProgress, type VoiceStatus } from '@shared/voice'
import { invoke, on } from '@/lib/ipc'
import { Recorder } from '@/lib/audio/recorder'
import { notify } from './notifications'
import { useSettings } from './settings'

/** A text field with a microphone button: where dictated text goes. */
export interface DictationTarget {
  element: () => HTMLTextAreaElement | HTMLInputElement | null
  /** The field is React-controlled: its value changes through its own setter. */
  setValue: (value: string) => void
}

export type DictationState = 'idle' | 'starting' | 'listening' | 'transcribing'

interface VoiceState {
  state: DictationState
  /** The field being dictated into. */
  targetId: string | null
  status: VoiceStatus | null
  progress: Record<string, VoiceProgress>
  init: () => () => void
  register: (id: string, target: DictationTarget) => () => void
  /** Starts dictation into `id`, or into the field that has (or last had) the focus. */
  start: (id?: string) => Promise<void>
  stop: () => Promise<void>
  toggle: (id?: string) => Promise<void>
  cancel: () => Promise<void>
  level: () => number
  loadStatus: () => Promise<void>
  installBinary: () => Promise<void>
  downloadModel: (id: WhisperModelId) => Promise<void>
  deleteModel: (id: WhisperModelId) => Promise<void>
  cancelDownload: (id: string) => Promise<void>
}

const targets = new Map<string, DictationTarget>()
let lastFocused: string | null = null
let recorder: Recorder | null = null

/** The registered field holding the focus, else the one that had it last and is still there. */
function focusedTarget(): string | null {
  const active = document.activeElement
  for (const [id, target] of targets) if (target.element() === active) return id
  return lastFocused && targets.get(lastFocused)?.element()?.isConnected ? lastFocused : null
}

function micError(err: unknown): string {
  const name = (err as DOMException | undefined)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return t('Clyde may not use the microphone. Allow it in the system privacy settings, then try again.')
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('No microphone found. Plug one in, or choose another in Settings › Voice.')
  if (name === 'NotReadableError') return t('The microphone is busy in another application.')
  return (err as Error)?.message ?? String(err)
}

export const useVoice = create<VoiceState>()((set, get) => ({
  state: 'idle',
  targetId: null,
  status: null,
  progress: {},

  init: () => {
    const onFocus = (e: FocusEvent) => {
      for (const [id, target] of targets) if (target.element() === e.target) lastFocused = id
    }
    document.addEventListener('focusin', onFocus)
    const off = on('voice:progress', (p) => {
      set({ progress: { ...get().progress, [p.id]: p } })
      if (p.state === 'done') void get().loadStatus()
      if (p.state === 'error') notify.error(t('Download failed'), p.error)
    })
    return () => {
      document.removeEventListener('focusin', onFocus)
      off()
    }
  },

  register: (id, target) => {
    targets.set(id, target)
    return () => {
      targets.delete(id)
      if (get().targetId === id) void get().cancel()
    }
  },

  start: async (id) => {
    if (get().state !== 'idle') return
    const targetId = id ?? focusedTarget()
    if (!targetId || !targets.has(targetId)) {
      notify.info(t('Click in a message field first, then dictate.'))
      return
    }
    set({ state: 'starting', targetId })
    try {
      if (!(await invoke('voice:micAccess'))) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
      recorder = new Recorder()
      await recorder.start(useSettings.getState().settings.voice.microphone, () => void get().stop())
      set({ state: 'listening' })
    } catch (err) {
      await recorder?.cancel()
      recorder = null
      set({ state: 'idle', targetId: null })
      notify.error(t('Dictation could not start'), micError(err))
    }
  },

  stop: async () => {
    if (get().state !== 'listening' || !recorder) return
    const { targetId } = get()
    set({ state: 'transcribing' })
    try {
      const recording = await recorder.stop()
      recorder = null
      if (!recording || recording.seconds < 0.3) {
        set({ state: 'idle', targetId: null })
        return
      }
      const { text } = await invoke('voice:transcribe', { audio: recording.audio })
      const target = targetId ? targets.get(targetId) : undefined
      const el = target?.element()
      // Inserted at the cursor, never sent: the user reads and sends it.
      if (target && el && text) {
        const { value, cursor } = insertDictation(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, text)
        target.setValue(value)
        requestAnimationFrame(() => {
          el.focus()
          el.setSelectionRange(cursor, cursor)
        })
      } else if (!text) {
        notify.info(t('Nothing was heard.'))
      }
    } catch (err) {
      notify.error(t('Transcription failed'), err)
    } finally {
      recorder = null
      set({ state: 'idle', targetId: null })
    }
  },

  toggle: async (id) => {
    const { state } = get()
    if (state === 'listening') await get().stop()
    else if (state === 'idle') await get().start(id)
  },

  cancel: async () => {
    await recorder?.cancel()
    recorder = null
    set({ state: 'idle', targetId: null })
  },

  level: () => recorder?.level() ?? 0,

  loadStatus: async () => {
    try {
      set({ status: await invoke('voice:status') })
    } catch (err) {
      notify.error(t('Could not read the dictation setup'), err)
    }
  },

  installBinary: async () => {
    await invoke('voice:installBinary').catch((err) => notify.error(t('Download failed'), err))
  },

  downloadModel: async (id) => {
    await invoke('voice:downloadModel', { id }).catch((err) => notify.error(t('Download failed'), err))
  },

  deleteModel: async (id) => {
    try {
      set({ status: await invoke('voice:deleteModel', { id }) })
    } catch (err) {
      notify.error(t('Could not delete the model'), err)
    }
  },

  cancelDownload: async (id) => {
    await invoke('voice:cancel', { id }).catch(() => undefined)
  }
}))
