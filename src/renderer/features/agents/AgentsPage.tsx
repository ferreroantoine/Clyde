import { SessionLimitLine } from '@/features/limits/LimitGauge'
import { intlLocale, t, tn } from '@shared/i18n'
import { useLimits } from '@/stores/limits'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import {
  Bot,
  CircleAlert,
  GitBranch,
  GitMerge,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  SearchCheck,
  Trash2,
  Undo2
} from 'lucide-react'
import { PERMISSION_LEVEL_LABELS } from '@shared/agent'
import { TASK_STATUSES, TASK_STATUS_LABELS, type AgentDefinition, type Task, type TaskStatus } from '@shared/tasks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { ProfileBadge, ProfileDot } from '@/components/ProfileBadge'
import { StatusDot, usd } from '@/features/agent-panel/SessionPane'
import { useAgents } from '@/stores/agents'
import { useBoard } from '@/stores/board'
import { useLayout } from '@/stores/layout'
import { profileById, useProfiles } from '@/stores/profiles'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { MicButton } from '@/components/MicButton'
import { Appear } from '@/components/Appear'
import { enter, spring, swap } from '@/lib/motion'
import { Skeleton } from '@/components/Skeleton'
import { AgentDialog } from './AgentDialog'
import { ReviewView } from './ReviewView'

function relativeTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{count} min ago', { count: Math.round(s / 60) })
  if (s < 86400) return t('{count} h ago', { count: Math.round(s / 3600) })
  return new Date(ms).toLocaleDateString(intlLocale())
}

/** What the task's agent session used: plan points on a subscription, cost on an API account. */
function TaskUse({ sessionId, subscription, costUsd }: { sessionId: string; subscription: boolean; costUsd: number }) {
  const usage = useLimits((s) => s.sessions[sessionId])
  const load = useLimits((s) => s.loadSession)
  useEffect(() => {
    if (subscription) void load(sessionId)
  }, [subscription, sessionId, load])
  if (!subscription) return costUsd > 0 ? <p className="text-[11px] text-muted-foreground tabular-nums">{usd(costUsd)}</p> : null
  return <SessionLimitLine usage={usage ?? []} className="text-[11px] text-muted-foreground" />
}

/** Drops the board accepts across columns: the same actions as the buttons. */
const DROP_ACTIONS: Partial<Record<`${TaskStatus}>${TaskStatus}`, 'start' | 'merge'>> = {
  'todo>in_progress': 'start',
  'review>done': 'merge'
}

function canDrop(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || `${from}>${to}` in DROP_ACTIONS
}

const DRAG_TYPE = 'application/x-clyde-task'

function TaskCard({ task, dragging, onDragStart, onDragEnd }: { task: Task; dragging: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  const agents = useBoard((s) => s.agents)
  const busy = useBoard((s) => !!s.busy[task.id])
  const startTask = useBoard((s) => s.startTask)
  const openReview = useBoard((s) => s.openReview)
  const deleteTask = useBoard((s) => s.deleteTask)
  const abandon = useBoard((s) => s.abandon)
  const profiles = useProfiles((s) => s.profiles)
  const session = useAgents((s) => (task.sessionId ? s.sessions[task.sessionId] : undefined))
  const selectSession = useAgents((s) => s.select)
  const setAgentPanelOpen = useLayout((s) => s.setAgentPanelOpen)
  const agent = agents.find((a) => a.id === task.agentId)
  const profile = profileById(profiles, agent?.profileId)

  const openChat = () => {
    if (!task.sessionId) return
    selectSession(task.sessionId)
    setAgentPanelOpen(true)
  }

  return (
    <motion.article
      layout
      layoutId={task.id}
      variants={enter}
      initial="hidden"
      animate="shown"
      exit="gone"
      transition={{ layout: spring.layout }}
      draggable
      onDragStartCapture={(e: DragEvent) => {
        e.dataTransfer.setData(DRAG_TYPE, task.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEndCapture={onDragEnd}
      className={cn(
        'group cursor-grab space-y-2 rounded-lg border bg-card p-3 text-xs shadow-xs transition-[box-shadow,opacity] hover:shadow-sm active:cursor-grabbing',
        dragging && 'opacity-40'
      )}
      aria-label={t('Task {title}', { title: task.title })}
      data-task-id={task.id}
      data-task-status={task.status}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13px] leading-snug font-medium">{task.title}</h4>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label={t('Actions for {name}', { name: task.title })} className="-mt-0.5 -mr-1 shrink-0">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {task.status !== 'done' && task.status !== 'todo' && (
              <DropdownMenuItem onSelect={() => void abandon(task.id)}>
                <Undo2 /> {' '}{t('Abandon')}</DropdownMenuItem>
            )}
            {(task.status === 'todo' || task.status === 'done') && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void deleteTask(task.id)}>
                  <Trash2 /> {' '}{t('Delete')}</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="line-clamp-2 text-muted-foreground">{task.description}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {profile ? <ProfileDot color={profile.color} /> : null}
        <span className="truncate">{agent?.name ?? t('No agent')}</span>
        <span className="flex items-center gap-1 font-mono">
          <GitBranch className="size-3" />
          {task.branch.replace(/^clyde\//, '')}
        </span>
        <span>· {relativeTime(task.updatedAt)}</span>
      </div>
      {task.sessionId && <TaskUse sessionId={task.sessionId} subscription={profile?.auth === 'subscription'} costUsd={session?.totals.costUsd ?? 0} />}
      {task.note && (
        <p className="flex items-start gap-1 text-[11px] text-warning">
          <CircleAlert className="mt-px size-3 shrink-0" />
          <span className="line-clamp-3">{task.note}</span>
        </p>
      )}
      <div className="flex gap-1.5">
        {task.status === 'todo' && (
          <Button size="xs" loading={busy} disabled={!agent} onClick={() => void startTask(task.id)}>
            <Play /> {t('Start')}
          </Button>
        )}
        {task.status === 'in_progress' && session && (
          <Button size="xs" variant="outline" onClick={openChat}>
            <StatusDot status={session.info.status} /> {' '}{t('Open chat')}</Button>
        )}
        {task.status === 'review' && (
          <>
            <Button size="xs" onClick={() => void openReview(task.id)}>
              <SearchCheck /> {' '}{t('Review')}</Button>
            {session && (
              <Button size="xs" variant="ghost" onClick={openChat}>
                <MessageSquare /> {' '}{t('Chat')}</Button>
            )}
          </>
        )}
        {task.status === 'done' && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
              task.outcome === 'merged' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
            )}
          >
            {task.outcome === 'merged' ? <GitMerge className="size-3" /> : <Undo2 className="size-3" />}
            {task.outcome === 'merged' ? (task.mergeCommit ? t('Merged · {sha}', { sha: task.mergeCommit.slice(0, 7) }) : t('Merged')) : t('Abandoned')}
          </span>
        )}
      </div>
    </motion.article>
  )
}

function NewTaskDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const agents = useBoard((s) => s.agents)
  const createTask = useBoard((s) => s.createTask)
  const creating = useBoard((s) => !!s.busy['new-task'])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const [agentId, setAgentId] = useState('')
  const chosen = agentId || agents[0]?.id || ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('New task')}</DialogTitle>
          <DialogDescription>{t('Clyde creates a branch and a git worktree for it, from the branch checked out now.')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!title.trim() || !description.trim() || !chosen) return
            void createTask({ title, description, agentId: chosen }).then((task) => {
              if (!task) return
              setTitle('')
              setDescription('')
              onOpenChange(false)
            })
          }}
        >
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">{t('Title')}</span>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Add a dark mode toggle')} maxLength={120} />
          </label>
          <label className="relative grid gap-1.5">
            <span className="text-xs font-medium">{t('What should the agent do?')}</span>
            <MicButton inputRef={descriptionRef} setValue={setDescription} size="xs" className="absolute right-1.5 bottom-1.5" />
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label={t('Task description')}
              placeholder={t('The agent receives this as its first message.')}
              className="min-h-28 w-full resize-y rounded-md border bg-transparent py-2 pr-10 pl-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">{t('Agent')}</span>
            <select
              value={chosen}
              onChange={(e) => setAgentId(e.target.value)}
              aria-label={t('Agent')}
              className="h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('Cancel')}</Button>
            <Button type="submit" loading={creating} disabled={!title.trim() || !description.trim() || !chosen}>
              {t('Create task')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const DROP_SLOT = Symbol('drop slot')

/** The card the pointer is above the middle of: the dragged card goes before it (null: last). */
function insertionPoint(e: DragEvent, draggedId: string): string | null {
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]')].filter((el) => el.dataset['taskId'] !== draggedId)
  for (const el of cards) {
    const box = el.getBoundingClientRect()
    if (e.clientY < box.top + box.height / 2) return el.dataset['taskId'] ?? null
  }
  return null
}

/**
 * The column's cards with an empty slot where the dragged card would land; the other cards
 * slide aside (layout animation). Within its own column the dragged card itself moves there.
 */
function placeCards(cards: Task[], beforeId: string | null, slot: boolean): Array<Task | typeof DROP_SLOT> {
  if (!slot) return cards
  const at = beforeId ? cards.findIndex((x) => x.id === beforeId) : -1
  return at < 0 ? [...cards, DROP_SLOT] : [...cards.slice(0, at), DROP_SLOT, ...cards.slice(at)]
}

/** The column as it will be once the dragged card is dropped before `beforeId`. */
function previewOrder(cards: Task[], dragged: Task, beforeId: string | null): Task[] {
  const rest = cards.filter((x) => x.id !== dragged.id)
  const at = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1
  return at < 0 ? [...rest, dragged] : [...rest.slice(0, at), dragged, ...rest.slice(at)]
}

function Board() {
  const tasks = useBoard((s) => s.tasks)
  const agents = useBoard((s) => s.agents)
  const workspace = useWorkspace((s) => s.info)
  const [creatingLocal, setCreating] = useState(false)
  const intent = useLayout((s) => s.intent)
  const clearIntent = useLayout((s) => s.clearIntent)
  const creating = creatingLocal || intent === 'new-task'
  const loaded = useBoard((s) => s.loaded)
  const reorder = useBoard((s) => s.reorder)
  const startTask = useBoard((s) => s.startTask)
  const merge = useBoard((s) => s.merge)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; status: TaskStatus; beforeId: string | null } | null>(null)
  const draggedTask = dragging ? tasks.find((x) => x.id === dragging) : undefined
  const endDrag = () => {
    setDragging(null)
    setDrop(null)
  }
  const onDropTask = (task: Task, status: TaskStatus, beforeId: string | null) => {
    if (status === task.status) {
      void reorder(task.id, beforeId)
      return
    }
    const action = DROP_ACTIONS[`${task.status}>${status}`]
    if (action === 'start') void startTask(task.id)
    if (action === 'merge') void merge(task.id)
  }
  const columns: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
  for (const x of tasks) columns[x.status].push(x)

  if (!workspace) {
    return <EmptyState icon={GitBranch} title={t('No folder open')} description={t('Open a git repository to plan tasks for your agents.')} />
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
        <p className="text-xs text-muted-foreground">
          {workspace.isGitRepo
            ? t('Tasks for {name}. Each one runs in its own branch and worktree.', { name: workspace.name })
            : t('This folder is not a git repository; tasks need one.')}
        </p>
        <Button size="sm" disabled={!workspace.isGitRepo || agents.length === 0} onClick={() => setCreating(true)} title={agents.length === 0 ? t('Create an agent first') : undefined}>
          <Plus /> {' '}{t('New task')}</Button>
      </div>
      <LayoutGroup>
        <div className="grid min-h-0 flex-1 grid-cols-[repeat(4,minmax(14rem,1fr))] gap-3 overflow-x-auto px-6 pb-6">
          {TASK_STATUSES.map((status) => {
            const allowed = draggedTask ? canDrop(draggedTask.status, status) : false
            const target = drop?.status === status ? drop : null
            const cards = target && draggedTask?.status === status ? previewOrder(columns[status], draggedTask, target.beforeId) : columns[status]
            return (
              <section
                key={status}
                className={cn(
                  'flex min-h-0 flex-col rounded-xl bg-muted/50 transition-[background-color,box-shadow] duration-150',
                  draggedTask && allowed && 'ring-1 ring-primary/30',
                  target && 'bg-primary/5 ring-2 ring-primary/40'
                )}
                aria-label={t(TASK_STATUS_LABELS[status])}
                data-column={status}
                onDragOver={(e) => {
                  if (!draggedTask || !allowed) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const beforeId = insertionPoint(e, draggedTask.id)
                  if (drop?.status !== status || drop.beforeId !== beforeId) setDrop({ id: draggedTask.id, status, beforeId })
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null) && drop?.status === status) setDrop(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (draggedTask) onDropTask(draggedTask, status, drop?.status === status ? drop.beforeId : null)
                  endDrag()
                }}
              >
                <h3 className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {t(TASK_STATUS_LABELS[status])}
                  <span className="rounded bg-background px-1.5 text-[10px] tabular-nums">{columns[status].length}</span>
                </h3>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  <AnimatePresence initial={false} mode="popLayout">
                    {placeCards(cards, target?.beforeId ?? null, !!target && draggedTask?.status !== status).map((x) =>
                      x === DROP_SLOT ? (
                        <motion.div
                          key="drop-slot"
                          layout
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 56 }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={spring.layout}
                          className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5"
                        />
                      ) : (
                        <TaskCard key={x.id} task={x} dragging={dragging === x.id} onDragStart={() => setDragging(x.id)} onDragEnd={endDrag} />
                      )
                    )}
                  </AnimatePresence>
                  {!loaded && status === 'todo' && <Skeleton className="h-20 w-full rounded-lg" />}
                  {loaded && columns[status].length === 0 && !target && (
                    <p className="px-1 py-4 text-center text-[11px] text-muted-foreground/70">{t('Nothing here')}</p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </LayoutGroup>
      <NewTaskDialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open)
          if (!open && intent === 'new-task') clearIntent()
        }}
      />
    </div>
  )
}

function AgentCard({ agent, onEdit }: { agent: AgentDefinition; onEdit: () => void }) {
  const profile = profileById(useProfiles((s) => s.profiles), agent.profileId)
  const deleteAgent = useBoard((s) => s.deleteAgent)
  const start = useAgents((s) => s.start)
  const workspace = useWorkspace((s) => s.info)
  const setAgentPanelOpen = useLayout((s) => s.setAgentPanelOpen)

  return (
    <article className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs" aria-label={t('Agent {name}', { name: agent.name })}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
          {profile && <ProfileBadge profile={profile} className="text-xs text-muted-foreground" />}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label={t('Actions for {name}', { name: agent.name })}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> {' '}{t('Edit')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void deleteAgent(agent.id)}>
              <Trash2 /> {' '}{t('Delete')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="text-[11px] text-muted-foreground">
        <span className="font-mono">{agent.model || t('default model')}</span> · {t(PERMISSION_LEVEL_LABELS[agent.permissionLevel])}
        {agent.mcpTools.length > 0 && ` · ${tn('{count} MCP tool', '{count} MCP tools', agent.mcpTools.length)}`}
      </p>
      {agent.systemPrompt && <p className="line-clamp-2 text-xs text-muted-foreground">{agent.systemPrompt}</p>}
      <div>
        <Button
          size="xs"
          variant="outline"
          disabled={!workspace}
          onClick={() => {
            setAgentPanelOpen(true)
            void start({
              profileId: agent.profileId,
              model: agent.model,
              permissionLevel: agent.permissionLevel,
              systemPrompt: agent.systemPrompt,
              mcpTools: agent.mcpTools,
              agentId: agent.id
            })
          }}
        >
          <MessageSquare /> {' '}{t('Chat in this folder')}</Button>
      </div>
    </article>
  )
}

function AgentsList() {
  const agents = useBoard((s) => s.agents)
  const [editing, setEditing] = useState<AgentDefinition | 'new' | null>(null)
  const intent = useLayout((s) => s.intent)
  const clearIntent = useLayout((s) => s.clearIntent)
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t('Saved agents run tasks on the board, or chat with you in the open folder.')}</p>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus /> {' '}{t('New agent')}</Button>
      </div>
      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14">
          <EmptyState icon={Bot} title={t('No agent yet')} description={t('Create one: an account, a model, a permission level and the MCP tools it may use.')} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Appear key={a.id}>
              <AgentCard agent={a} onEdit={() => setEditing(a)} />
            </Appear>
          ))}
        </div>
      )}
      <AgentDialog
        open={editing !== null || intent === 'new-agent'}
        onOpenChange={(o) => {
          if (o) return
          setEditing(null)
          if (intent === 'new-agent') clearIntent()
        }}
        {...(editing && editing !== 'new' ? { agent: editing } : {})}
      />
    </div>
  )
}

export function AgentsPage() {
  const [chosenTab, setTab] = useState<'board' | 'agents'>('board')
  const intent = useLayout((s) => s.intent)
  const tab = intent === 'new-agent' ? 'agents' : intent === 'new-task' ? 'board' : chosenTab
  const review = useBoard((s) => s.review)
  const reviewTask = useBoard((s) => (s.review ? s.tasks.find((t) => t.id === s.review?.taskId) : undefined))
  if (review && reviewTask) return <ReviewView task={reviewTask} />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-end gap-6 border-b px-6 pt-6">
        <h1 className="pb-2 text-lg font-semibold tracking-tight">{t('Agents')}</h1>
        <nav className="flex gap-4" role="tablist">
          {(
            [
              ['board', t('Board')],
              ['agents', t('Saved agents')]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                'press relative pb-2 text-sm outline-none focus-visible:text-foreground focus-visible:underline',
                tab === value ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
              {tab === value && <motion.span layoutId="agents-tab" transition={spring.layout} className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
            </button>
          ))}
        </nav>
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} variants={swap} initial="hidden" animate="shown" exit="gone" className="min-h-0 flex-1">
          {tab === 'board' ? <Board /> : <AgentsList />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
