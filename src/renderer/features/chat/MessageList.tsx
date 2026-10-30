import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, FileText, LoaderCircle, Pencil, RefreshCw, Wrench } from 'lucide-react'
import { t, tn } from '@shared/i18n'
import type { ChatAttachment, ChatMessage } from '@shared/chat'
import { Button } from '@/components/ui/button'
import { Appear } from '@/components/Appear'
import { invoke } from '@/lib/ipc'
import type { SessionView } from '@/lib/transcript'
import { useChat } from '@/stores/chat'
import { iconSwap } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { CopyButton, Markdown } from './Markdown'

/** An image attachment, loaded from main when it scrolls into the list. */
function AttachmentChip({ conversationId, attachment }: { conversationId: string; attachment: ChatAttachment }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (attachment.kind !== 'image') return
    let alive = true
    void invoke('chat:attachment', { id: conversationId, attachmentId: attachment.id })
      .then(({ mime, data }) => alive && setSrc(`data:${mime};base64,${data}`))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [conversationId, attachment])
  if (attachment.kind === 'image') {
    return src ? (
      <img src={src} alt={attachment.name} title={attachment.name} className="max-h-48 max-w-64 rounded-lg border object-contain" />
    ) : (
      <div className="skeleton size-24 rounded-lg" aria-label={attachment.name} />
    )
  }
  return (
    <span className="inline-flex max-w-64 items-center gap-1.5 rounded-lg border bg-background px-2 py-1 text-xs" title={attachment.name}>
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{attachment.name}</span>
    </span>
  )
}

function UserMessage({ message, busy }: { message: ChatMessage; busy: boolean }) {
  const edit = useChat((s) => s.edit)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(message.content)
  return (
    <div className="group flex flex-col items-end gap-1.5" data-role="user">
      {message.attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {message.attachments.map((a) => (
            <AttachmentChip key={a.id} conversationId={message.conversationId} attachment={a} />
          ))}
        </div>
      )}
      {editing ? (
        <form
          className="w-full max-w-[85%] space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            setEditing(false)
            void edit(message.id, text.trim())
          }}
        >
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            aria-label={t('Edit your message')}
            className="min-h-24 w-full resize-y rounded-xl border bg-background px-3.5 py-2.5 text-[14px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={!text.trim()}>
              {t('Save and send')}
            </Button>
          </div>
        </form>
      ) : (
        message.content && (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap">{message.content}</div>
        )
      )}
      {!editing && (
        <div className="flex gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton text={message.content} />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setText(message.content)
              setEditing(true)
            }}
            className="press inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            aria-label={t('Edit')}
            title={t('Edit and send again')}
          >
            <Pencil className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function ToolsUsed({ tools }: { tools: ChatMessage['tools'] }) {
  const [open, setOpen] = useState(false)
  if (tools.length === 0) return null
  return (
    <div className="mb-2 text-xs text-muted-foreground">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="press inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground">
        <Wrench className="size-3.5" /> {tn('Used {count} tool', 'Used {count} tools', tools.length)}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-5">
          {tools.map((tool, i) => (
            <li key={i} className={cn('font-mono text-[11px]', tool.isError && 'text-destructive')}>
              {tool.name.replace(/^mcp__([^_]+(?:[-_][^_]+)*?)__/, '$1 › ')}
              {tool.summary && <span className="text-muted-foreground"> · {tool.summary}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AssistantMessage({ message, last, busy }: { message: ChatMessage; last: boolean; busy: boolean }) {
  const regenerate = useChat((s) => s.regenerate)
  return (
    <div className="group" data-role="assistant" data-status={message.status}>
      <ToolsUsed tools={message.tools} />
      {message.content && <Markdown text={message.content} />}
      {message.status === 'stopped' && <p className="mt-2 text-xs text-muted-foreground italic">{t('Stopped.')}</p>}
      {message.status === 'error' && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {message.error ?? t('The answer failed.')}
        </p>
      )}
      <div className="mt-1.5 flex gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        {message.content && <CopyButton text={message.content} />}
        {last && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void regenerate()}
            className="press inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            aria-label={t('Regenerate')}
            title={t('Regenerate')}
          >
            <RefreshCw className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/** The answer as it streams: text with a caret, and the tools being used. */
function LiveAnswer({ view }: { view: SessionView | undefined }) {
  const items = view?.items ?? []
  const texts = items.filter((i) => i.kind === 'text')
  const tools = items.filter((i) => i.kind === 'tool')
  const text = texts.map((i) => i.text).join('\n\n')
  return (
    <div data-role="assistant" data-status="streaming" aria-live="polite">
      {tools.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          {tools.map((tool) => (
            <li key={tool.toolUseId} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', !tool.result && 'shimmer')}>
              <span className="relative grid size-3 place-items-center">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={tool.result ? 'done' : 'run'} variants={iconSwap} initial="hidden" animate="shown" exit="gone" className="absolute inset-0">
                    {tool.result ? <Wrench className="size-3" /> : <LoaderCircle className="size-3 animate-spin" />}
                  </motion.span>
                </AnimatePresence>
              </span>
              {tool.name.replace(/^mcp__([^_]+(?:[-_][^_]+)*?)__/, '$1 › ')}
            </li>
          ))}
        </ul>
      )}
      {text ? (
        <Markdown text={text} streaming />
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="size-1.5 rounded-full bg-muted-foreground"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </span>
          {t('Thinking…')}
        </p>
      )}
    </div>
  )
}

/** The conversation, centered at a comfortable reading width, following new text as it comes. */
export function MessageList({ conversationId }: { conversationId: string }) {
  const messages = useChat((s) => s.messages[conversationId])
  const live = useChat((s) => s.live[conversationId])
  const stream = useChat((s) => (live?.sessionId ? s.streams[live.sessionId] : undefined))
  const busy = !!live?.busy
  const scroller = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const lastTop = useRef(0)
  const lastAssistant = messages?.findLast((m) => m.role === 'assistant')

  useEffect(() => {
    const el = scroller.current
    if (!el || !stuck.current) return
    const smooth = document.documentElement.dataset['motion'] === 'full'
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [messages?.length, stream, busy])

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) stuck.current = true
        else if (el.scrollTop < lastTop.current - 2) stuck.current = false
        lastTop.current = el.scrollTop
      }}
    >
      <div className="mx-auto w-full max-w-[760px] space-y-7 px-6 py-8">
        {!messages && <div className="skeleton h-24 w-full" />}
        {messages?.map((m) => (
          <Appear key={m.id}>
            {m.role === 'user' ? <UserMessage message={m} busy={busy} /> : <AssistantMessage message={m} last={m === lastAssistant && !busy} busy={busy} />}
          </Appear>
        ))}
        {busy && (
          <Appear>
            <LiveAnswer view={stream} />
          </Appear>
        )}
      </div>
    </div>
  )
}
