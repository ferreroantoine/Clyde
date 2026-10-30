import { encodeWav, resample, toBase64 } from './wav'

export const WHISPER_RATE = 16_000
/** Ten minutes; whisper works on short dictation anyway. */
const MAX_SECONDS = 600

/**
 * Microphone capture for dictation: raw PCM through the Web Audio API (MediaRecorder's
 * WebM is not something whisper.cpp reads), resampled to 16 kHz mono WAV at the end.
 */
export class Recorder {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private processor: ScriptProcessorNode | null = null
  private chunks: Float32Array[] = []
  private samples = 0
  private readonly levels = new Uint8Array(256)

  /** Throws the browser's NotAllowedError / NotFoundError as they come. */
  async start(deviceId: string, onLimit: () => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true }
    })
    this.context = new AudioContext({ sampleRate: WHISPER_RATE })
    const source = this.context.createMediaStreamSource(this.stream)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 512
    // ScriptProcessorNode is deprecated but needs no separate worklet file, which the CSP would complicate.
    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    const rate = this.context.sampleRate
    this.processor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0)
      this.chunks.push(new Float32Array(data))
      this.samples += data.length
      if (this.samples / rate >= MAX_SECONDS) onLimit()
    }
    source.connect(this.analyser)
    source.connect(this.processor)
    this.processor.connect(this.context.destination)
  }

  /** Loudness between 0 and 1, for the level bars. */
  level(): number {
    if (!this.analyser) return 0
    this.analyser.getByteTimeDomainData(this.levels)
    let sum = 0
    for (const v of this.levels) sum += ((v - 128) / 128) ** 2
    return Math.min(1, Math.sqrt(sum / this.levels.length) * 4)
  }

  /** Stops and returns the WAV as base64, or null when nothing was recorded. */
  async stop(): Promise<{ audio: string; seconds: number } | null> {
    const rate = this.context?.sampleRate ?? WHISPER_RATE
    await this.release()
    if (this.samples === 0) return null
    const all = new Float32Array(this.samples)
    let offset = 0
    for (const chunk of this.chunks) {
      all.set(chunk, offset)
      offset += chunk.length
    }
    this.chunks = []
    const pcm = resample(all, rate, WHISPER_RATE)
    return { audio: toBase64(encodeWav(pcm, WHISPER_RATE)), seconds: pcm.length / WHISPER_RATE }
  }

  async cancel(): Promise<void> {
    this.chunks = []
    this.samples = 0
    await this.release()
  }

  private async release(): Promise<void> {
    this.processor?.disconnect()
    this.analyser?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.context?.close().catch(() => undefined)
    this.processor = null
    this.analyser = null
    this.stream = null
    this.context = null
  }
}
