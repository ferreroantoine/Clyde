import { useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, FileText, Paperclip, Square, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { IMAGE_MIMES, MAX_IMAGE_ATTACHMENT, MAX_TEXT_ATTACHMENT } from '@shared/chat'
import { Button } from '@/components/ui/button'
import { EXPLORER_PATH_TYPE } from '@/features/explorer/FileTree'
import { notify } from '@/stores/notifications'
import type { PendingAttachment } from '@/stores/chat'
import { enter } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { DictationHint, MicButton } from '@/components/MicButton'

const IMAGE_SET = new Set<string>(IMAGE_MIMES)

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/** A file from the system (picker, drop, paste), checked for size and read as base64. */
async function fromFile(file: File): Promise<PendingAttachment | null> {
  const image = IMAGE_SET.has(file.type)
  const max = image ? MAX_IMAGE_ATTACHMENT : MAX_TEXT_ATTACHMENT
  if (file.size > max) {
    notify.error(t('{name} is too large to attach', { name: file.name }))
    return null
  }
  const url = await readAsDataUrl(file)
  const data = url.slice(url.indexOf(',') + 1)
  return {
    key: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name || t('Pasted image'),
    size: file.size,
    input: { name: file.name || 'pasted.png', mime: file.type, data },
    ...(image ? { preview: url } : {})
  }
}

/**
 * The message box: grows with the text, Enter sends, Shift+Enter adds a line, Stop while
 * the answer comes. Files come from the paperclip, a drop (from the system or the
 * Explorer) or a paste.
 */
export function Composer({
  busy,
  disabled,
  onSend,
  onStop,
  placeholder
}: {
  busy: boolean
  disabled: boolean
  onSend: (text: string, attachments: PendingAttachment[]) => Promise<boolean>
  onStop: () => void
  placeholder: string
}) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [over, setOver] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`
  }, [text])

  const add = (items: Array<PendingAttachment | null>) => {
    const fresh = items.filter((a): a is PendingAttachment => !!a)
    setAttachments((current) => [...current, ...fresh.filter((a) => !current.some((c) => c.key === a.key))].slice(0, 10))
  }
  const addFiles = async (files: FileList | File[]) => add(await Promise.all([...files].map((f) => fromFile(f).catch(() => null))))

  const submit = async () => {
    if (busy || disabled || (!text.trim() && attachments.length === 0)) return
    const sending = { text, attachments }
    setText('')
    setAttachments([])
    if (!(await onSend(sending.text, sending.attachments))) {
      setText(sending.text)
      setAttachments(sending.attachments)
    }
    area.current?.focus()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const path = e.dataTransfer.getData(EXPLORER_PATH_TYPE)
    if (path) {
      add([{ key: `ws:${path}`, name: path.split('/').pop() ?? path, size: 0, input: { path } }])
      return
    }
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files)
  }

  return (
    <div
      className="mx-auto w-full max-w-[760px] px-4 pb-4"
      onDragOver={(e) => {
        if (disabled) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={onDrop}
    >
      <div
        className={cn(
          'rounded-2xl border bg-background shadow-sm transition-[box-shadow,border-color] duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30',
          over && 'border-primary ring-2 ring-primary/30'
        )}
      >
        <AnimatePresence initial={false}>
          {attachments.length > 0 && (
            <motion.ul
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex flex-wrap gap-2 overflow-hidden px-3 pt-3"
              aria-label={t('Attachments')}
            >
              <AnimatePresence initial={false}>
                {attachments.map((a) => (
                  <motion.li
                    key={a.key}
                    layout
                    variants={enter}
                    initial="hidden"
                    animate="shown"
                    exit="gone"
                    className="flex max-w-56 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-1.5 text-xs"
                  >
                    {a.preview ? (
                      <img src={a.preview} alt="" className="size-8 rounded object-cover" />
                    ) : (
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 truncate">{a.name}</span>
                    <button
                      type="button"
                      aria-label={t('Remove {name}', { name: a.name })}
                      onClick={() => setAttachments((list) => list.filter((x) => x.key !== a.key))}
                      className="press rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          )}
        </AnimatePresence>
        <textarea
          ref={area}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => IMAGE_SET.has(f.type))
            if (files.length) {
              e.preventDefault()
              void addFiles(files)
            }
          }}
          placeholder={placeholder}
          aria-label={t('Message')}
          className="block max-h-[280px] min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
          <div className="flex items-center gap-1">
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t('Attach files')} title={t('Attach files')} disabled={disabled} onClick={() => picker.current?.click()}>
              <Paperclip />
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <MicButton inputRef={area} setValue={setText} />
          </div>
          {busy ? (
            <Button type="button" size="icon-sm" variant="outline" aria-label={t('Stop the answer')} onClick={onStop} className="rounded-full">
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              aria-label={t('Send')}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              onClick={() => void submit()}
              className="rounded-full"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
      <DictationHint className="mt-1.5 text-center" />
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{t('Enter to send, Shift+Enter for a new line.')}</p>
    </div>
  )
}
