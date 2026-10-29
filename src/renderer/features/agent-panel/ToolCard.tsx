import { useState } from 'react'
import {
  Ban,
  Check,
  ChevronRight,
  CircleAlert,
  FilePen,
  FileText,
  Globe,
  ListTodo,
  LoaderCircle,
  Search,
  ShieldQuestion,
  SquareTerminal,
  Users,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { describeTool, toolState, type ToolItem } from '@/lib/transcript'
import { useAgents } from '@/stores/agents'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = {
  Bash: SquareTerminal,
  PowerShell: SquareTerminal,
  Monitor: SquareTerminal,
  Read: FileText,
  Write: FilePen,
  Edit: FilePen,
  MultiEdit: FilePen,
  NotebookEdit: FilePen,
  Glob: Search,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  Agent: Users,
  Task: Users,
  TodoWrite: ListTodo
}

const DECISION_LABEL = {
  'allow-once': 'Allowed once',
  'allow-session': 'Allowed for this session',
  deny: 'Denied',
  cancelled: 'Cancelled'
} as const

function Approval({ tool }: { tool: ToolItem }) {
  const answer = useAgents((s) => s.answer)
  const [denying, setDenying] = useState(false)
  const [message, setMessage] = useState('')
  const approval = tool.approval
  if (!approval) return null
  const shell = tool.name === 'Bash' || tool.name === 'PowerShell' || tool.name === 'Monitor'

  if (approval.state !== 'pending') {
    return (
      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        {DECISION_LABEL[approval.state]}
      </p>
    )
  }
  return (
    <div className="space-y-2 border-t border-warning/40 bg-warning/10 px-3 py-2.5" role="group" aria-label="Approval request">
      <p className="flex items-start gap-1.5 text-xs">
        <ShieldQuestion className="mt-px size-3.5 shrink-0 text-warning" />
        <span>{approval.reason}</span>
      </p>
      {denying ? (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void answer(approval.requestId, 'deny', message)
          }}
        >
          <Input
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell the agent what to do instead (optional)"
            className="h-7 text-xs"
          />
          <Button type="submit" size="xs" variant="destructive">
            Deny
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" onClick={() => void answer(approval.requestId, 'allow-once')}>
            Allow once
          </Button>
          <Button
            size="xs"
            variant="outline"
            title={shell ? 'Allows this exact command until the session ends' : `Allows ${tool.name} until the session ends`}
            onClick={() => void answer(approval.requestId, 'allow-session')}
          >
            {shell ? 'Allow this command for the session' : `Allow ${tool.name} for the session`}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setDenying(true)}>
            Deny…
          </Button>
        </div>
      )}
    </div>
  )
}

export function ToolCard({ tool, cwd, ended }: { tool: ToolItem; cwd: string; ended: boolean }) {
  const state = toolState(tool, ended)
  const [open, setOpen] = useState(false)
  const Icon = ICONS[tool.name] ?? Wrench
  const summary = describeTool(tool.name, tool.input, cwd)

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card text-xs',
        tool.parentToolUseId && 'ml-4',
        state === 'awaiting' && 'border-warning/60'
      )}
      data-tool={tool.name}
      data-state={state}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent/50"
      >
        <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{tool.name.replace(/^mcp__/, '')}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{summary}</span>
        {state === 'running' && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        {state === 'done' && <Check className="size-3.5 shrink-0 text-success" />}
        {state === 'error' && <CircleAlert className="size-3.5 shrink-0 text-destructive" />}
        {state === 'denied' && <Ban className="size-3.5 shrink-0 text-muted-foreground" />}
        {state === 'awaiting' && <ShieldQuestion className="size-3.5 shrink-0 text-warning" />}
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2">
          <pre className="max-h-48 overflow-auto font-mono text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
            {JSON.stringify(tool.input, null, 2)}
          </pre>
          {tool.denied && <p className="text-[11px] text-muted-foreground">Refused: {tool.denied}</p>}
          {tool.result && (
            <pre
              className={cn(
                'max-h-64 overflow-auto rounded border bg-muted/50 px-2 py-1.5 font-mono text-[11px] leading-snug whitespace-pre-wrap',
                tool.result.isError && 'border-destructive/40 text-destructive'
              )}
            >
              {tool.result.content || '(no output)'}
            </pre>
          )}
        </div>
      )}
      <Approval tool={tool} />
    </div>
  )
}
