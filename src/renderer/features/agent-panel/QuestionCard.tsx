import { useState } from 'react'
import { motion } from 'motion/react'
import { Check, CornerDownLeft, MessageCircleQuestion } from 'lucide-react'
import { t } from '@shared/i18n'
import type { AgentQuestion } from '@shared/agent'
import { Button } from '@/components/ui/button'
import type { ToolItem } from '@/lib/transcript'
import { useAgents } from '@/stores/agents'
import { attention } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** What the user picked for one question: option labels, plus their own text when "Other" is on. */
interface Choice {
  picked: string[]
  other: boolean
  text: string
}

const EMPTY: Choice = { picked: [], other: false, text: '' }

function answerOf(choice: Choice): string {
  return [...choice.picked, ...(choice.other && choice.text.trim() ? [choice.text.trim()] : [])].join(', ')
}

/** A choice button: a radio dot for one answer, a check box for several. */
function Option({
  label,
  description,
  selected,
  multi,
  onClick,
  children
}: {
  label: string
  description?: string
  selected: boolean
  multi: boolean
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-md border transition-colors',
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:border-foreground/20 hover:bg-accent/50'
      )}
    >
      <button type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={selected} onClick={onClick} className="press-soft press flex w-full items-start gap-2 px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span
          className={cn(
            'mt-0.5 grid size-3.5 shrink-0 place-items-center border',
            multi ? 'rounded-[3px]' : 'rounded-full',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'
          )}
        >
          {selected && (multi ? <Check className="size-2.5" strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-current" />)}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium">{label}</span>
          {description && <span className="block text-[11px] leading-snug text-muted-foreground">{description}</span>}
        </span>
      </button>
      {children}
    </div>
  )
}

function Question({ q, choice, onChange, onSubmit }: { q: AgentQuestion; choice: Choice; onChange: (c: Choice) => void; onSubmit: (c: Choice) => void }) {
  const multi = q.multiSelect
  const toggle = (label: string) => {
    if (!multi) {
      const next = { picked: [label], other: false, text: choice.text }
      onChange(next)
      onSubmit(next)
      return
    }
    const picked = choice.picked.includes(label) ? choice.picked.filter((l) => l !== label) : [...choice.picked, label]
    onChange({ ...choice, picked })
  }
  return (
    <div className="space-y-1.5" role={multi ? 'group' : 'radiogroup'} aria-label={q.question}>
      {q.header && <span className="inline-block rounded bg-muted px-1.5 py-px text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{q.header}</span>}
      <p className="text-[13px] leading-snug font-medium">{q.question}</p>
      {multi && <p className="text-[11px] text-muted-foreground">{t('Several answers possible')}</p>}
      <div className="grid gap-1">
        {q.options.map((o) => (
          <Option key={o.label} label={o.label} description={o.description} selected={choice.picked.includes(o.label)} multi={multi} onClick={() => toggle(o.label)} />
        ))}
        <Option
          label={t('Other…')}
          selected={choice.other}
          multi={multi}
          onClick={() => onChange(multi ? { ...choice, other: !choice.other } : { picked: [], other: true, text: choice.text })}
        >
          {choice.other && (
            <form
              className="flex items-center gap-1.5 px-2.5 pb-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (choice.text.trim()) onSubmit(choice)
              }}
            >
              <input
                autoFocus
                value={choice.text}
                onChange={(e) => onChange({ ...choice, text: e.target.value })}
                placeholder={t('Your answer')}
                aria-label={t('Your answer')}
                className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {!multi && (
                <Button type="submit" size="icon-xs" aria-label={t('Send')} disabled={!choice.text.trim()}>
                  <CornerDownLeft />
                </Button>
              )}
            </form>
          )}
        </Option>
      </div>
    </div>
  )
}

/** Multiple-choice questions from the agent (AskUserQuestion, ask_user), answered with a click. */
export function QuestionCard({ tool }: { tool: ToolItem }) {
  const answerQuestions = useAgents((s) => s.answerQuestions)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [sent, setSent] = useState(false)
  const block = tool.questions
  if (!block) return null
  const { questions } = block

  if (block.state !== 'pending') {
    return (
      <div className="rounded-lg border bg-card px-3 py-2 text-xs" data-tool={tool.name} data-state="done">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <MessageCircleQuestion className="size-3.5" />
          {block.state === 'skipped' ? t('Questions skipped') : questions.length > 1 ? t('Your answers') : t('Your answer')}
        </p>
        <ul className="space-y-1">
          {questions.map((q) => (
            <li key={q.question}>
              <span className="text-muted-foreground">{q.question}</span>
              {block.answers?.[q.question] && (
                <span className="mt-0.5 flex items-start gap-1 font-medium">
                  <Check className="mt-0.5 size-3 shrink-0 text-success" />
                  {block.answers[q.question]}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const choiceOf = (q: AgentQuestion) => choices[q.question] ?? EMPTY
  const complete = (all: Record<string, Choice>) => questions.every((q) => answerOf(all[q.question] ?? EMPTY))
  const send = (all: Record<string, Choice>) => {
    if (sent || !complete(all)) return
    setSent(true)
    void answerQuestions(block.requestId, Object.fromEntries(questions.map((q) => [q.question, answerOf(all[q.question] ?? EMPTY)])))
  }
  // One single-choice question goes as soon as it is answered; anything else waits for Send.
  const instant = questions.length === 1 && !questions[0]?.multiSelect

  return (
    <motion.div
      variants={attention}
      initial="hidden"
      animate="shown"
      className="space-y-3 rounded-lg border border-primary/40 bg-card px-3 py-2.5 text-xs shadow-sm"
      data-tool={tool.name}
      data-state="awaiting"
      role="group"
      aria-label={t('Questions from the agent')}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
        <MessageCircleQuestion className="size-3.5" />
        {questions.length > 1 ? t('The agent has {count} questions', { count: questions.length }) : t('The agent has a question')}
      </p>
      {questions.map((q) => (
        <Question
          key={q.question}
          q={q}
          choice={choiceOf(q)}
          onChange={(c) => setChoices((all) => ({ ...all, [q.question]: c }))}
          onSubmit={(c) => {
            if (instant) send({ [q.question]: c })
          }}
        />
      ))}
      <div className="flex items-center justify-end gap-1.5">
        <Button size="xs" variant="ghost" disabled={sent} onClick={() => {
          setSent(true)
          void answerQuestions(block.requestId, null)
        }}>
          {t('Skip')}
        </Button>
        {!instant && (
          <Button size="xs" disabled={sent || !complete(choices)} onClick={() => send(choices)}>
            {t('Send')}
          </Button>
        )}
      </div>
    </motion.div>
  )
}
