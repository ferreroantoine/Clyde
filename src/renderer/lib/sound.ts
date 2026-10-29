let context: AudioContext | null = null

/** A short, soft chime: two notes up for "done", one note held for "needs you". */
export function chime(kind: 'done' | 'attention'): void {
  try {
    context ??= new AudioContext()
    const ctx = context
    const notes = kind === 'done' ? [660, 880] : [740]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const start = ctx.currentTime + i * 0.12
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.08, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (kind === 'done' ? 0.25 : 0.45))
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.5)
    })
  } catch {
    // No audio device: stay silent.
  }
}
