import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, ChevronDown, ChevronRight, FolderOpen, HandHelping, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2, User } from 'lucide-react'
import { t, tn } from '@shared/i18n'
import { TODO_STATUS_LABELS, type Todo, type TodoStatus } from '@shared/todos'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { ProfileDot } from '@/components/ProfileBadge'
import { Skeleton } from '@/components/Skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { spring } from '@/lib/motion'
import { columnsOf } from '@/lib/todo-view'
import { cn } from '@/lib/utils'
import { useLayout } from '@/stores/layout'
import { useTodos } from '@/stores/todos'
import { useWorkspace } from '@/stores/workspace'
import { handOver, openSession, useOwner } from './owner'

const COLUMNS: TodoStatus[] = ['todo', 'in_progress', 'done']

/** The card the pointer is above the middle of: the dragged card goes before it (null: last). */
function insertionPoint(e: DragEvent, draggedId: string): string | null {
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-todo-id]')].filter((el) => el.dataset['todoId'] !== draggedId)
  for (const el of cards) {
    const box = el.getBoundingClientRect()
    if (e.clientY < box.top + box.height / 2) return el.dataset['todoId'] ?? null
  }
  return null
}

function OwnerLabel({ sessionId, className }: { sessionId: string | null; className?: string }) {
  const owner = useOwner(sessionId)
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {sessionId ? <ProfileDot color={owner.color ?? 'var(--muted-foreground)'} /> : <User className="size-3 shrink-0" />}
      <span className="truncate">{owner.name}</span>
    </span>
  )
}

function TodoCard({ todo, onDragStart, onDragEnd, dragging }: { todo: Todo; onDragStart: () => void; onDragEnd: () => void; dragging: boolean }) {
  const edit = useTodos((s) => s.edit)
  const remove = useTodos((s) => s.remove)
  const owner = useOwner(todo.sessionId)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(todo.text)
  const working = todo.status === 'in_progress' && todo.sessionId !== null
  const done = todo.status === 'done'

  const save = () => {
    setEditing(false)
    const value = text.trim()
    if (value && value !== todo.text) void edit(todo.id, value)
    else setText(todo.text)
  }

  return (
    <motion.article
      layout="position"
      transition={spring.layout}
      data-todo-id={todo.id}
      data-status={todo.status}
      draggable={!editing}
      onDragStart={(e) => {
        const ev = e as unknown as DragEvent
        ev.dataTransfer.effectAllowed = 'move'
        ev.dataTransfer.setData('text/plain', todo.text)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      // An agent's task: one click shows where it is at, in its session.
      onClick={() => !editing && todo.sessionId && openSession(todo.sessionId)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      className={cn(
        'group relative rounded-lg border bg-card px-3 py-2 text-[13px] shadow-xs',
        todo.sessionId && 'cursor-pointer hover:border-foreground/20',
        working && 'border-primary/40 bg-primary/5',
        dragging && 'opacity-40'
      )}
      aria-label={todo.text}
    >
      {editing ? (
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              setText(todo.text)
              setEditing(false)
            }
          }}
          aria-label={t('Task')}
          className="w-full resize-none rounded border bg-background px-1.5 py-1 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          rows={2}
        />
      ) : (
        <p className={cn('pr-5 leading-snug break-words', done && 'text-muted-foreground line-through')}>{todo.text}</p>
      )}
      {working && todo.active && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-primary">
          <span className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="truncate">{t('Now: {what}', { what: todo.active })}</span>
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <OwnerLabel sessionId={todo.sessionId} />
        {working && !todo.active && <span className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-label={t('In progress')} />}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="press absolute top-1.5 right-1.5 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label={t('Actions for {name}', { name: todo.text })}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> {t('Edit')}
          </DropdownMenuItem>
          {todo.sessionId && (
            <DropdownMenuItem onSelect={() => todo.sessionId && openSession(todo.sessionId)}>
              <MessageSquare /> {t('Open the session')}
            </DropdownMenuItem>
          )}
          {/* A task of an ended session can go to the session open now. */}
          {!done && (!todo.sessionId || !owner.live) && (
            <DropdownMenuItem onSelect={() => void handOver(todo)}>
              <HandHelping /> {t('Hand to the agent')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void remove(todo.id)}>
            <Trash2 /> {t('Delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.article>
  )
}

function AddTask() {
  const create = useTodos((s) => s.create)
  const draft = useTodos((s) => s.addDraft)
  const [text, setText] = useState('')
  const field = useRef<HTMLInputElement>(null)
  // Text sent from the explorer ("Add to tasks…") lands here, ready to be completed.
  const [seen, setSeen] = useState(0)
  if (draft && draft.id !== seen) {
    setSeen(draft.id)
    setText(draft.text)
  }
  useEffect(() => {
    if (draft?.id) field.current?.focus()
  }, [draft?.id])
  return (
    <form
      className="flex items-center gap-1.5 rounded-lg border border-dashed bg-background/60 px-2 focus-within:border-solid focus-within:ring-2 focus-within:ring-ring"
      onSubmit={(e) => {
        e.preventDefault()
        const value = text.trim()
        if (!value) return
        setText('')
        void create(value)
      }}
    >
      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={field}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('Add a task…')}
        aria-label={t('Add a task')}
        data-testid="add-task"
        className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      />
    </form>
  )
}

function SessionFilterItem({ sessionId, onSelect }: { sessionId: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="text-xs">
      <OwnerLabel sessionId={sessionId} />
    </DropdownMenuItem>
  )
}

function FilterBar() {
  const filter = useTodos((s) => s.filter)
  const setFilter = useTodos((s) => s.setFilter)
  const hideDone = useTodos((s) => s.hideDone)
  const setHideDone = useTodos((s) => s.setHideDone)
  const sessions = useTodos((s) => [...new Set(s.todos.flatMap((x) => (x.sessionId ? [x.sessionId] : [])))].join('|'))
  const ids = sessions ? sessions.split('|') : []
  const chip = (active: boolean) =>
    cn('press rounded-md px-2 py-1 text-xs', active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')
  return (
    <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label={t('Filter the tasks')}>
      <button type="button" className={chip(filter.kind === 'all')} onClick={() => setFilter({ kind: 'all' })}>
        {t('All')}
      </button>
      <button type="button" className={chip(filter.kind === 'mine')} onClick={() => setFilter({ kind: 'mine' })}>
        {t('My tasks')}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(chip(filter.kind === 'session'), 'flex items-center gap-1')} disabled={ids.length === 0}>
          {filter.kind === 'session' ? <OwnerLabel sessionId={filter.sessionId} /> : t('A session')}
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">{t('Sessions with tasks')}</DropdownMenuLabel>
          {ids.map((id) => (
            <SessionFilterItem key={id} sessionId={id} onSelect={() => setFilter({ kind: 'session', sessionId: id })} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <label className="ml-3 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="accent-[var(--primary)]" />
        {t('Hide done tasks')}
      </label>
    </div>
  )
}

function Column({
  status,
  cards,
  older,
  dragged,
  setDragged
}: {
  status: TodoStatus
  cards: Todo[]
  older: Todo[]
  dragged: Todo | null
  setDragged: (todo: Todo | null) => void
}) {
  const move = useTodos((s) => s.move)
  const loaded = useTodos((s) => s.loaded)
  const [target, setTarget] = useState<{ beforeId: string | null } | null>(null)
  const [showOlder, setShowOlder] = useState(false)
  return (
    <section
      className={cn('flex min-h-0 flex-col rounded-xl bg-muted/50 transition-[background-color,box-shadow] duration-150', dragged && 'ring-1 ring-primary/20', target && 'bg-primary/5 ring-2 ring-primary/40')}
      aria-label={t(TODO_STATUS_LABELS[status])}
      data-column={status}
      onDragOver={(e) => {
        if (!dragged) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const beforeId = insertionPoint(e, dragged.id)
        if (target?.beforeId !== beforeId) setTarget({ beforeId })
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setTarget(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        if (dragged) void move(dragged.id, status, target?.beforeId ?? null)
        setTarget(null)
        setDragged(null)
      }}
    >
      <h3 className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {t(TODO_STATUS_LABELS[status])}
        <span className="rounded bg-background px-1.5 text-[10px] tabular-nums">{cards.length + older.length}</span>
      </h3>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {status === 'todo' && <AddTask />}
        <AnimatePresence initial={false}>
          {cards.map((todo) => (
            <TodoCard key={todo.id} todo={todo} dragging={dragged?.id === todo.id} onDragStart={() => setDragged(todo)} onDragEnd={() => setDragged(null)} />
          ))}
        </AnimatePresence>
        {!loaded && status === 'todo' && <Skeleton className="h-16 w-full rounded-lg" />}
        {loaded && cards.length === 0 && older.length === 0 && status !== 'todo' && (
          <p className="px-1 py-4 text-center text-[11px] text-muted-foreground/70">{t('Nothing here')}</p>
        )}
        {older.length > 0 && (
          <>
            <button type="button" className="press flex w-full items-center gap-1 px-1 py-1 text-[11px] text-muted-foreground hover:text-foreground" aria-expanded={showOlder} onClick={() => setShowOlder(!showOlder)}>
              <ChevronRight className={cn('size-3 transition-transform', showOlder && 'rotate-90')} />
              {tn('{count} done more than a week ago', '{count} done more than a week ago', older.length)}
            </button>
            {showOlder &&
              older.map((todo) => (
                <TodoCard key={todo.id} todo={todo} dragging={dragged?.id === todo.id} onDragStart={() => setDragged(todo)} onDragEnd={() => setDragged(null)} />
              ))}
          </>
        )}
      </div>
    </section>
  )
}

/**
 * The shared task list of the open project: To do, In progress, Done. Agents keep their own
 * tasks here as they work (by reflex, through their task-list tool); the user adds, moves and
 * hands over tasks. A click on an agent's task opens its session.
 */
export function TasksPage() {
  const workspace = useWorkspace((s) => s.info)
  const pick = useWorkspace((s) => s.pick)
  const todos = useTodos((s) => s.todos)
  const filter = useTodos((s) => s.filter)
  const hideDone = useTodos((s) => s.hideDone)
  const intent = useLayout((s) => s.intent)
  const clearIntent = useLayout((s) => s.clearIntent)
  const [dragged, setDragged] = useState<Todo | null>(null)
  // "More than a week ago" needs no live clock: the time the view opened is enough.
  const [now] = useState(() => Date.now())

  // The palette's "New task…": focus the add field.
  useEffect(() => {
    if (intent !== 'new-task') return
    useTodos.getState().draft('')
    clearIntent()
  }, [intent, clearIntent])

  if (!workspace) {
    return (
      <EmptyState
        icon={FolderOpen}
        title={t('No folder open')}
        description={t('Tasks belong to a project: open a folder to see its tasks and what its agents are doing.')}
        action={
          <Button size="sm" onClick={() => void pick()}>
            {t('Open folder')}
          </Button>
        }
      />
    )
  }
  const columns = columnsOf(todos, filter, now)
  const empty = todos.length === 0
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tasks-page">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b px-6 pt-6 pb-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t('Tasks')}</h1>
          <p className="text-xs text-muted-foreground">
            {t('{name}: your tasks and the ones your agents are working on.', { name: workspace.name })}
          </p>
        </div>
        <FilterBar />
      </header>
      {empty && (
        <p className="flex shrink-0 items-center gap-1.5 px-6 pt-3 text-xs text-muted-foreground">
          <Bot className="size-3.5" />
          {t('Agents write their task list here as they work. Add your own tasks, or hand one to the agent.')}
        </p>
      )}
      <div className={cn('grid min-h-0 flex-1 gap-3 overflow-x-auto px-6 py-4', hideDone ? 'grid-cols-[repeat(2,minmax(16rem,1fr))]' : 'grid-cols-[repeat(3,minmax(16rem,1fr))]')}>
        {COLUMNS.filter((s) => !(hideDone && s === 'done')).map((status) => (
          <Column
            key={status}
            status={status}
            cards={columns[status]}
            older={status === 'done' ? columns.olderDone : []}
            dragged={dragged}
            setDragged={setDragged}
          />
        ))}
      </div>
    </div>
  )
}
