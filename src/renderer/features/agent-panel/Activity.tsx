import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Brain, ChevronRight, Layers, LoaderCircle } from 'lucide-react'
import { t, tn } from '@shared/i18n'
import { summarize } from '@/lib/activity'
import { toolState, type ToolItem } from '@/lib/transcript'
import { duration, ease } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { ToolCard } from './ToolCard'
import { ToolImages } from './ToolImages'

const reveal = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1, transition: { duration: duration.base, ease: ease.out } },
  exit: { height: 0, opacity: 0, transition: { duration: duration.fast, ease: ease.out } }
}

/**
 * The model's reasoning between two actions. Open while it is being written, folded to its first
 * line once done; a click unfolds it.
 */
export function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null)
  const shown = open ?? live
  const preview = text.trim().split('\n').find((line) => line.trim()) ?? ''
  return (
    <div className="text-xs" data-testid="thinking">
      <button
        type="button"
        onClick={() => setOpen(!shown)}
        aria-expanded={shown}
        className="press-soft flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', shown && 'rotate-90')} />
        <Brain className={cn('size-3.5 shrink-0', live && 'animate-pulse text-primary')} />
        <span className="shrink-0 font-medium">{live ? t('Thinking…') : t('Thought')}</span>
        {!shown && <span className="min-w-0 flex-1 truncate italic">{preview.replace(/^[#*\s]+/, '')}</span>}
      </button>
      <AnimatePresence initial={false}>
        {shown && (
          <motion.div {...reveal} className="overflow-hidden">
            <p className="ml-[1.1rem] border-l-2 border-muted py-0.5 pl-3 leading-relaxed whitespace-pre-wrap text-muted-foreground italic">{text}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * A run of actions with nothing said in between, folded under one line ("6 actions — 3 files
 * read, 2 commands"). The action in progress and every screenshot stay visible when folded.
 */
export function ActionGroup({ tools, cwd, ended, sessionId }: { tools: ToolItem[]; cwd: string; ended: boolean; sessionId: string }) {
  const [open, setOpen] = useState(false)
  const states = tools.map((tool) => toolState(tool, ended))
  const running = states.includes('running')
  const failed = states.filter((s) => s === 'error').length
  const current = running ? tools[states.lastIndexOf('running')] : undefined
  const images = tools.flatMap((tool) => tool.result?.images ?? [])
  return (
    <div className="rounded-lg border border-dashed text-xs" data-testid="action-group">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="press-soft flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-accent/50 focus-visible:bg-accent/60"
      >
        <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <Layers className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{tn('{count} action', '{count} actions', tools.length)}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{summarize(tools)}</span>
        {failed > 0 && <span className="shrink-0 text-destructive">{tn('{count} failed', '{count} failed', failed)}</span>}
        {running && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="all" {...reveal} className="overflow-hidden">
            <div className="space-y-1.5 border-t border-dashed p-1.5">
              {tools.map((tool) => (
                <ToolCard key={tool.toolUseId} tool={tool} cwd={cwd} ended={ended} sessionId={sessionId} />
              ))}
            </div>
          </motion.div>
        ) : (
          (current || images.length > 0) && (
            <motion.div key="folded" {...reveal} className="overflow-hidden">
              <div className="space-y-1.5 border-t border-dashed p-1.5">
                {current && <ToolCard tool={current} cwd={cwd} ended={ended} sessionId={sessionId} />}
                <ToolImages sessionId={sessionId} images={images} className="px-1" />
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  )
}
