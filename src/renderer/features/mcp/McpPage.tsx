import { useState } from 'react'
import {
  ChevronRight,
  CircleAlert,
  FileInput,
  Globe,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Power,
  RefreshCw,
  SquareTerminal,
  Trash2
} from 'lucide-react'
import type { McpImportPreview, McpServer } from '@shared/mcp'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/EmptyState'
import { useMcp } from '@/stores/mcp'
import { cn } from '@/lib/utils'
import { McpServerDialog } from './McpServerDialog'

const STATUS = {
  connected: { label: 'Connected', dot: 'bg-success' },
  connecting: { label: 'Connecting', dot: 'animate-pulse bg-muted-foreground' },
  error: { label: 'Error', dot: 'bg-destructive' },
  disabled: { label: 'Off', dot: 'bg-muted-foreground/40' }
} as const

function ServerCard({ server, onEdit, onDelete }: { server: McpServer; onEdit: () => void; onDelete: () => void }) {
  const update = useMcp((s) => s.update)
  const reconnect = useMcp((s) => s.reconnect)
  const [open, setOpen] = useState(false)
  const status = STATUS[server.status]
  const Icon = server.transport === 'stdio' ? SquareTerminal : Globe
  const summary = server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : server.url

  return (
    <article className="rounded-xl border bg-card shadow-xs" aria-label={`MCP server ${server.name}`} data-status={server.status}>
      <header className="flex items-center gap-3 px-4 py-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{server.name}</h3>
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', status.dot)} />
              {status.label}
              {server.status === 'connected' && ` · ${server.tools.length} tool${server.tools.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={summary}>
            {summary}
          </p>
        </div>
        <Button
          size="xs"
          variant="outline"
          onClick={() => void update({ id: server.id, enabled: !server.enabled })}
          aria-label={server.enabled ? `Turn off ${server.name}` : `Turn on ${server.name}`}
        >
          <Power /> {server.enabled ? 'Turn off' : 'Turn on'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${server.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!server.enabled} onSelect={() => void reconnect(server.id)}>
              <RefreshCw /> Reconnect
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {server.error && (
        <p className="flex items-start gap-1.5 border-t px-4 py-2 text-xs text-destructive">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          <span className="break-words">{server.error}</span>
        </p>
      )}
      {server.tools.length > 0 && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs text-muted-foreground hover:bg-accent/40"
          >
            <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
            Tools
          </button>
          {open && (
            <ul className="space-y-1.5 px-4 pb-3">
              {server.tools.map((tool) => (
                <li key={tool.name} className="text-xs">
                  <span className="font-mono font-medium">{tool.name}</span>
                  {tool.description && <span className="text-muted-foreground"> · {tool.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  )
}

function ImportDialog({ preview, onClose }: { preview: McpImportPreview | null; onClose: () => void }) {
  const importServers = useMcp((s) => s.importServers)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preview?.servers.filter((s) => !s.exists).map((s) => s.name) ?? [])
  )
  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelected(next)
  }
  return (
    <Dialog open={!!preview} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import MCP servers</DialogTitle>
          <DialogDescription className="truncate font-mono text-[11px]">{preview?.path}</DialogDescription>
        </DialogHeader>
        {preview && preview.servers.length === 0 && <p className="text-sm text-muted-foreground">No server to import in this file.</p>}
        <ul className="max-h-80 space-y-1.5 overflow-y-auto">
          {preview?.servers.map((s) => (
            <li key={s.name}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-xs hover:bg-accent/40">
                <input
                  type="checkbox"
                  checked={selected.has(s.name)}
                  onChange={() => toggle(s.name)}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {s.name}
                    {s.exists && <span className="font-normal text-muted-foreground"> · already added</span>}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{s.summary}</span>
                  {s.envKeys.length > 0 && (
                    <span className="block text-[11px] text-muted-foreground">
                      {s.transport === 'stdio' ? 'Environment' : 'Headers'}: {s.envKeys.join(', ')} (stored encrypted)
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {preview && preview.skipped.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Skipped: {preview.skipped.map((s) => `${s.name} (${s.reason.toLowerCase()})`).join(', ')}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={selected.size === 0}
            onClick={() => {
              if (!preview) return
              void importServers(preview.path, [...selected]).then((ok) => ok && onClose())
            }}
          >
            Import {selected.size || ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function McpPage() {
  const servers = useMcp((s) => s.servers)
  const loaded = useMcp((s) => s.loaded)
  const remove = useMcp((s) => s.remove)
  const previewImport = useMcp((s) => s.previewImport)
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null)
  const [deleting, setDeleting] = useState<McpServer | null>(null)
  const [preview, setPreview] = useState<McpImportPreview | null>(null)
  const [picking, setPicking] = useState(false)

  const pick = async () => {
    setPicking(true)
    setPreview(await previewImport())
    setPicking(false)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">MCP servers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tools for your agents. An agent only sees the tools you tick when you start it.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void pick()} disabled={picking}>
              {picking ? <LoaderCircle className="animate-spin" /> : <FileInput />} Import claude_desktop_config.json
            </Button>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> Add server
            </Button>
          </div>
        </div>

        {loaded && servers.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed py-14">
            <EmptyState
              icon={Plug}
              title="No MCP server yet"
              description="Add a local command or a remote URL, or import the servers you already use in Claude Desktop."
            />
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {servers.map((s) => (
              <ServerCard key={s.id} server={s} onEdit={() => setEditing(s)} onDelete={() => setDeleting(s)} />
            ))}
          </div>
        )}
      </div>

      <McpServerDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        {...(editing && editing !== 'new' ? { server: editing } : {})}
      />
      {preview && <ImportDialog key={preview.path} preview={preview} onClose={() => setPreview(null)} />}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>Agents started from now on lose its tools. Its stored variables are deleted too.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) void remove(deleting.id)
                setDeleting(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
