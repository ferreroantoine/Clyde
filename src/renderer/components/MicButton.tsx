import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LoaderCircle, Mic } from 'lucide-react'
import { t } from '@shared/i18n'
import { effectiveBindings, formatCombo } from '@shared/keybindings'
import { useSettings } from '@/stores/settings'
import { useVoice } from '@/stores/voice'
import { iconSwap } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** Five bars that follow the microphone level while listening. */
function LevelBars() {
  const level = useVoice((s) => s.level)
  const [values, setValues] = useState([0, 0, 0, 0, 0])
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const v = level()
      // Each bar reacts a little differently, like a small equalizer.
      setValues([0.55, 0.85, 1, 0.75, 0.5].map((k, i) => Math.min(1, v * k * (0.8 + 0.4 * Math.abs(Math.sin(Date.now() / 160 + i))))))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [level])
  return (
    <span className="flex h-3.5 items-center gap-[2px]" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className="w-[2px] rounded-full bg-current transition-[height] duration-75" style={{ height: `${Math.max(18, v * 100)}%` }} />
      ))}
    </span>
  )
}

/**
 * Microphone for a text field: click to start and stop (or hold the dictation shortcut).
 * The transcript lands at the cursor and is never sent on its own.
 */
export function MicButton({
  inputRef,
  setValue,
  className,
  size = 'sm'
}: {
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  setValue: (value: string) => void
  className?: string
  size?: 'xs' | 'sm'
}) {
  const id = useId()
  const register = useVoice((s) => s.register)
  const toggle = useVoice((s) => s.toggle)
  const state = useVoice((s) => (s.targetId === id ? s.state : 'idle'))
  const busyElsewhere = useVoice((s) => s.state !== 'idle' && s.targetId !== id)
  const setter = useRef(setValue)
  useEffect(() => {
    setter.current = setValue
  }, [setValue])
  useEffect(() => register(id, { element: () => inputRef.current, setValue: (v) => setter.current(v) }), [id, inputRef, register])

  const binding = effectiveBindings(useSettings((s) => s.settings.shortcuts.bindings))['voice.toggle']
  const hold = useSettings((s) => s.settings.voice.mode) === 'hold'
  const shortcut = binding ? formatCombo(binding) : ''
  const label =
    state === 'listening'
      ? t('Stop dictation (Enter)')
      : state === 'transcribing'
        ? t('Transcribing…')
        : shortcut
          ? hold ? t('Dictate (or hold {shortcut})', { shortcut }) : t('Dictate ({shortcut})', { shortcut })
          : t('Dictate')

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={state === 'listening'}
      disabled={busyElsewhere || state === 'transcribing' || state === 'starting'}
      onMouseDown={(e) => e.preventDefault()} // keep the cursor where it is in the field
      onClick={() => void toggle(id)}
      className={cn(
        'press relative inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
        size === 'xs' ? 'size-6 [&_svg]:size-3.5' : 'size-8 [&_svg]:size-4',
        state === 'listening' && 'bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive',
        className
      )}
      data-dictation={state}
    >
      {state === 'listening' && (
        <motion.span
          className="absolute inset-0 rounded-full ring-2 ring-destructive/40"
          initial={{ opacity: 0.8, scale: 1 }}
          animate={{ opacity: 0, scale: 1.45 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
          aria-hidden
        />
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={state === 'listening' ? 'bars' : state === 'transcribing' || state === 'starting' ? 'busy' : 'mic'} variants={iconSwap} initial="hidden" animate="shown" exit="gone" className="grid place-items-center">
          {state === 'listening' ? <LevelBars /> : state === 'transcribing' || state === 'starting' ? <LoaderCircle className="animate-spin" /> : <Mic />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/** "Listening…" / "Transcribing…" under a field, while it is the dictation target. */
export function DictationHint({ className }: { className?: string }) {
  const state = useVoice((s) => s.state)
  const hold = useSettings((s) => s.settings.voice.mode) === 'hold'
  return (
    <AnimatePresence>
      {(state === 'listening' || state === 'transcribing') && (
        <motion.p
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={cn('text-[11px] text-muted-foreground', className)}
          role="status"
        >
          {state === 'listening' ? (hold ? t('Listening… release the keys or press Enter to stop, Escape to cancel.') : t('Listening… press Enter or click the microphone to stop, Escape to cancel.')) : t('Transcribing…')}
        </motion.p>
      )}
    </AnimatePresence>
  )
}
