import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react'
import { t } from '@shared/i18n'
import { ArrowUp, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MicButton } from '@/components/MicButton'
import { EXPLORER_PATH_TYPE } from '@/features/explorer/FileTree'
import { mention } from '@/features/explorer/mention'
import { useAgents } from '@/stores/agents'
import { cn } from '@/lib/utils'

/**
 * The agent panel's message box, for a session or for the one about to start (`draftId` '').
 * Its text is the store's draft, so text added from elsewhere (the explorer) lands here.
 */
export function Composer({
  draftId,
  placeholder,
  locked = false,
  canSend = true,
  busy = false,
  onSubmit,
  onInterrupt
}: {
  draftId: string
  placeholder: string
  /** No typing at all (a session that has ended for good). */
  locked?: boolean
  /** Typing is fine, sending waits (a session still starting, no folder open). */
  canSend?: boolean
  /** The agent is working: the button interrupts it. */
  busy?: boolean
  /** Resolves false when the message did not go: the text comes back. */
  onSubmit: (text: string) => Promise<boolean>
  onInterrupt?: () => void
}) {
  const text = useAgents((s) => s.drafts[draftId] ?? '')
  const storeDraft = useAgents((s) => s.setDraft)
  const setText = useCallback(
    (value: SetStateAction<string>) => {
      const current = useAgents.getState().drafts[draftId] ?? ''
      storeDraft(draftId, typeof value === 'function' ? value(current) : value)
    },
    [draftId, storeDraft]
  )
  const focusTick = useAgents((s) => s.focusTick)
  const area = useRef<HTMLTextAreaElement>(null)

  // Text added from elsewhere (the explorer) gets the focus, the caret at its end.
  useEffect(() => {
    const el = area.current
    if (!focusTick || !el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [focusTick])

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  const submit = async () => {
    const value = text.trim()
    if (!value || locked || !canSend) return
    setText('')
    if (!(await onSubmit(value))) setText(value)
  }

  const [over, setOver] = useState(false)

  return (
    <div
      className="border-t p-2"
      // Files dragged from the Explorer become @mentions, which Claude Code reads itself.
      onDragOver={(e) => {
        if (locked || !e.dataTransfer.types.includes(EXPLORER_PATH_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        setOver(false)
        const path = e.dataTransfer.getData(EXPLORER_PATH_TYPE)
        if (!path) return
        e.preventDefault()
        setText((current) => (current && !/\s$/.test(current) ? `${current} ` : current) + mention(path))
        area.current?.focus()
      }}
    >
      <div
        className={cn(
          'flex items-end gap-1.5 rounded-lg border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring',
          over && 'border-primary ring-2 ring-primary/30'
        )}
      >
        <textarea
          ref={area}
          rows={1}
          value={text}
          disabled={locked}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={placeholder}
          aria-label={t('Message to the agent')}
          className="max-h-[200px] min-h-6 flex-1 resize-none bg-transparent py-0.5 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <MicButton inputRef={area} setValue={setText} size="xs" />
        {busy ? (
          <Button type="button" size="icon-xs" variant="outline" aria-label={t('Interrupt the agent')} onClick={onInterrupt}>
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button type="button" size="icon-xs" aria-label={t('Send')} disabled={!text.trim() || locked || !canSend} onClick={() => void submit()}>
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  )
}
