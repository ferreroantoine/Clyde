import { describe, expect, it } from 'vitest'
import { encodeWav, resample, toBase64 } from './wav'

describe('wav', () => {
  it('writes a 16 kHz mono PCM header and clamps samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
    const view = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(40, true)).toBe(8)
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767])
  })

  it('resamples to the target rate', () => {
    const out = resample(new Float32Array([0, 1, 0, 1, 0, 1]), 48000, 16000)
    expect(out.length).toBe(2)
    expect(resample(new Float32Array([1, 2]), 16000, 16000)).toEqual(new Float32Array([1, 2]))
  })

  it('encodes base64 in chunks', () => {
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=')
  })
})
