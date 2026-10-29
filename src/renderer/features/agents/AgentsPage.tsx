import { useState } from 'react'
import {
  Bot,
  CircleAlert,
  GitBranch,
  GitMerge,
  LoaderCircle,
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
import { StatusDot } from '@/features/agent-panel/SessionPane'
import { useAgents } from '@/stores/agents'
import { useBoard } from '@/stores/board'
import { useLayout } from '@/stores/layout'
import { profileById, useProfiles } from '@/stores/profiles'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { AgentDialog } from './AgentDialog'
import { ReviewView } from './ReviewView'

function relativeTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(ms).toLocaleDateString()
}

function TaskCard({ task }: { task: Task }) {
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
    <article
      className="group space-y-2 rounded-lg border bg-card p-3 text-xs shadow-xs transition-shadow hover:shadow-sm"
      aria-label={`Task ${task.title}`}
      data-task-status={task.status}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13px] leading-snug font-medium">{task.title}</h4>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${task.title}`} className="-mt-0.5 -mr-1 shrink-0">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {task.status !== 'done' && task.status !== 'todo' && (
              <DropdownMenuItem onSelect={() => void abandon(task.id)}>
                <Undo2 /> Abandon
              </DropdownMenuItem>
            )}
            {(task.status === 'todo' || task.status === 'done') && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void deleteTask(task.id)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="line-clamp-2 text-muted-foreground">{task.description}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {profile ? <ProfileDot color={profile.color} /> : null}
        <span className="truncate">{agent?.name ?? 'No agent'}</span>
        <span className="flex items-center gap-1 font-mono">
          <GitBranch className="size-3" />
          {task.branch.replace(/^atelier\//, '')}
        </span>
        <span>· {relativeTime(task.updatedAt)}</span>
      </div>
      {task.note && (
        <p className="flex items-start gap-1 text-[11px] text-warning">
          <CircleAlert className="mt-px size-3 shrink-0" />
          <span className="line-clamp-3">{task.note}</span>
        </p>
      )}
      <div className="flex gap-1.5">
        {task.status === 'todo' && (
          <Button size="xs" disabled={busy || !agent} onClick={() => void startTask(task.id)}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Play />} Start
          </Button>
        )}
        {task.status === 'in_progress' && session && (
          <Button size="xs" variant="outline" onClick={openChat}>
            <StatusDot status={session.info.status} /> Open chat
          </Button>
        )}
        {task.status === 'review' && (
          <>
            <Button size="xs" onClick={() => void openReview(task.id)}>
              <SearchCheck /> Review
            </Button>
            {session && (
              <Button size="xs" variant="ghost" onClick={openChat}>
                <MessageSquare /> Chat
              </Button>
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
            {task.outcome === 'merged' ? `Merged${task.mergeCommit ? ` · ${task.mergeCommit.slice(0, 7)}` : ''}` : 'Abandoned'}
          </span>
        )}
      </div>
    </article>
  )
}

function NewTaskDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const agents = useBoard((s) => s.agents)
  const createTask = useBoard((s) => s.createTask)
  const creating = useBoard((s) => !!s.busy['new-task'])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [agentId, setAgentId] = useState('')
  const chosen = agentId || agents[0]?.id || ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Atelier creates a branch and a git worktree for it, from the branch checked out now.</DialogDescription>
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
            <span className="text-xs font-medium">Title</span>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a dark mode toggle" maxLength={120} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">What should the agent do?</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="Task description"
              placeholder="The agent receives this as its first message."
              className="min-h-28 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Agent</span>
            <select
              value={chosen}
              onChange={(e) => setAgentId(e.target.value)}
              aria-label="Agent"
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
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || !description.trim() || !chosen || creating}>
              {creating && <LoaderCircle className="animate-spin" />} Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Board() {
  const tasks = useBoard((s) => s.tasks)
  const agents = useBoard((s) => s.agents)
  const workspace = useWorkspace((s) => s.info)
  const [creatingLocal, setCreating] = useState(false)
  const intent = useLayout((s) => s.intent)
  const clearIntent = useLayout((s) => s.clearIntent)
  const creating = creatingLocal || intent === 'new-task'
  const columns: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
  for (const t of tasks) columns[t.status].push(t)

  if (!workspace) {
    return <EmptyState icon={GitBranch} title="No folder open" description="Open a git repository to plan tasks for your agents." />
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
        <p className="text-xs text-muted-foreground">
          {workspace.isGitRepo ? `Tasks for ${workspace.name}. Each one runs in its own branch and worktree.` : 'This folder is not a git repository; tasks need one.'}
        </p>
        <Button size="sm" disabled={!workspace.isGitRepo || agents.length === 0} onClick={() => setCreating(true)} title={agents.length === 0 ? 'Create an agent first' : undefined}>
          <Plus /> New task
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(4,minmax(14rem,1fr))] gap-3 overflow-x-auto px-6 pb-6">
        {TASK_STATUSES.map((status) => (
          <section key={status} className="flex min-h-0 flex-col rounded-xl bg-muted/50" aria-label={TASK_STATUS_LABELS[status]}>
            <h3 className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {TASK_STATUS_LABELS[status]}
              <span className="rounded bg-background px-1.5 text-[10px] tabular-nums">{columns[status].length}</span>
            </h3>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {columns[status].map((t) => (
                <TaskCard key={t.id} task={t} />
              ))}
              {columns[status].length === 0 && <p className="px-1 py-4 text-center text-[11px] text-muted-foreground/70">Nothing here</p>}
            </div>
          </section>
        ))}
      </div>
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
    <article className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs" aria-label={`Agent ${agent.name}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
          {profile && <ProfileBadge profile={profile} className="text-xs text-muted-foreground" />}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${agent.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void deleteAgent(agent.id)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="text-[11px] text-muted-foreground">
        <span className="font-mono">{agent.model || 'default model'}</span> · {PERMISSION_LEVEL_LABELS[agent.permissionLevel]}
        {agent.mcpTools.length > 0 && ` · ${agent.mcpTools.length} MCP tool${agent.mcpTools.length > 1 ? 's' : ''}`}
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
          <MessageSquare /> Chat in this folder
        </Button>
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
        <p className="text-xs text-muted-foreground">Saved agents run tasks on the board, or chat with you in the open folder.</p>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus /> New agent
        </Button>
      </div>
      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14">
          <EmptyState icon={Bot} title="No agent yet" description="Create one: an account, a model, a permission level and the MCP tools it may use." />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} onEdit={() => setEditing(a)} />
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
        <h1 className="pb-2 text-lg font-semibold tracking-tight">Agents</h1>
        <nav className="flex gap-4" role="tablist">
          {(
            [
              ['board', 'Board'],
              ['agents', 'Saved agents']
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                '-mb-px border-b-2 pb-2 text-sm transition-colors',
                tab === value ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1">{tab === 'board' ? <Board /> : <AgentsList />}</div>
    </div>
  )
}
