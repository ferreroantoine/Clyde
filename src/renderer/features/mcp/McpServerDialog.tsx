import { useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { Globe, SquareTerminal } from 'lucide-react'
import type { McpServer } from '@shared/mcp'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useMcp } from '@/stores/mcp'
import { cn } from '@/lib/utils'

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  )
}

const textareaClass =
  'min-h-16 w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** `KEY=VALUE` per line. Lines without `=` are ignored; the first `=` splits. */
export function parsePairs(text: string, separator = '='): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const index = line.indexOf(separator)
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    if (key) out[key] = line.slice(index + separator.length).trim()
  }
  return out
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  server?: McpServer
}

export function McpServerDialog({ open, onOpenChange, server }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <ServerForm {...(server ? { server } : {})} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ServerForm({ server, close }: { server?: McpServer; close: () => void }) {
  const create = useMcp((s) => s.create)
  const update = useMcp((s) => s.update)
  const [transport, setTransport] = useState<'stdio' | 'http'>(server?.transport ?? 'stdio')
  const [name, setName] = useState(server?.name ?? '')
  const [command, setCommand] = useState(server?.command ?? '')
  const [args, setArgs] = useState((server?.args ?? []).join('\n'))
  const [url, setUrl] = useState(server?.url ?? '')
  const [secrets, setSecrets] = useState('')
  const [replaceSecrets, setReplaceSecrets] = useState(!server)
  const [saving, setSaving] = useState(false)
  const editing = !!server
  const secretKeys = transport === 'stdio' ? (server?.envKeys ?? []) : (server?.headerKeys ?? [])

  const canSave = name.trim() && (transport === 'stdio' ? command.trim() : /^https?:\/\/\S+$/i.test(url.trim())) && !saving

  const save = async () => {
    setSaving(true)
    const argList = args.split('\n').map((a) => a.trim()).filter(Boolean)
    const pairs = transport === 'stdio' ? parsePairs(secrets) : parsePairs(secrets, ':')
    const ok = editing
      ? await update({
          id: server.id,
          name,
          ...(transport === 'stdio' ? { command, args: argList } : { url: url.trim() }),
          ...(replaceSecrets ? (transport === 'stdio' ? { env: pairs } : { headers: pairs }) : {})
        })
      : await create(
          transport === 'stdio'
            ? { transport, name, command, args: argList, env: pairs }
            : { transport, name, url: url.trim(), headers: pairs }
        )
    setSaving(false)
    if (ok) close()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? t('Edit {name}', { name: server.name }) : t('Add an MCP server')}</DialogTitle>
        <DialogDescription>
          {t('Clyde connects to the server and lists its tools. Each agent only sees the tools you allow when you start it.')}</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSave) void save()
        }}
      >
        {!editing && (
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('Transport')}>
            {(
              [
                ['stdio', SquareTerminal, t('Local command'), t('Clyde starts the server (stdio).')],
                ['http', Globe, t('Remote URL'), t('Streamable HTTP, or SSE for older servers.')]
              ] as const
            ).map(([value, Icon, title, description]) => (
              <button
                key={value}
                type="button"
                aria-pressed={transport === value}
                onClick={() => setTransport(value)}
                className={cn(
                  'flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors',
                  transport === value ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-[13px] font-medium">{title}</span>
                  <span className="block text-[11px] text-muted-foreground">{description}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <Field label={t('Name')} hint={t('Tools appear as mcp__<name>__<tool>.')}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('github')} maxLength={60} />
        </Field>

        {transport === 'stdio' ? (
          <>
            <Field label={t('Command')}>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t('npx')}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </Field>
            <Field label={t('Arguments')} hint={t('One per line.')}>
              <textarea
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder={'-y\n@modelcontextprotocol/server-filesystem\nC:\\work'}
                className={textareaClass}
                spellCheck={false}
              />
            </Field>
          </>
        ) : (
          <Field label={t('URL')}>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('https://mcp.example.com/mcp')}
              className="font-mono text-xs"
              spellCheck={false}
            />
          </Field>
        )}

        <Field
          label={transport === 'stdio' ? t('Environment variables') : t('Headers')}
          hint={
            editing && !replaceSecrets
              ? undefined
              : t('{format} per line. Encrypted like API keys; values are never shown again.', { format: transport === 'stdio' ? 'KEY=value' : 'Name: value' })
          }
        >
          {editing && !replaceSecrets ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              <span className="truncate font-mono">{secretKeys.length ? secretKeys.join(', ') : t('None')}</span>
              <Button type="button" size="xs" variant="outline" onClick={() => setReplaceSecrets(true)}>
                {t('Replace')}</Button>
            </div>
          ) : (
            <textarea
              value={secrets}
              onChange={(e) => setSecrets(e.target.value)}
              placeholder={transport === 'stdio' ? 'GITHUB_TOKEN=ghp_…' : 'Authorization: Bearer …'}
              className={textareaClass}
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </Field>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t('Cancel')}</Button>
          <Button type="submit" disabled={!canSave}>
            {editing ? t('Save') : t('Add server')}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
