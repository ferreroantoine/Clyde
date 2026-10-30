import { useState } from 'react'
import { t, tk, tn } from '@shared/i18n'
import { ChevronRight, Plug, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { ANTIGRAVITY_LEVEL_HINTS, PERMISSION_LEVELS, PERMISSION_LEVEL_LABELS, type PermissionLevel } from '@shared/agent'
import type { ProfileKind } from '@shared/profiles'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMcp } from '@/stores/mcp'
import { cn } from '@/lib/utils'
import { estimateTokens, TOOL_COUNT_WARNING, TOOL_TOKENS_WARNING } from '@shared/mcp-catalog'

export const LEVEL_HINTS: Record<PermissionLevel, string> = {
  'validate-all': tk('Every file change and command asks first.'),
  'files-auto': tk('Edits inside the folder run; commands ask.'),
  autonomous: tk('Runs freely inside the folder. No git push.')
}

/** Connected servers with checkboxes per server and per tool. Nothing is ticked by default. */
export function McpPicker({ value, onChange }: { value: Set<string>; onChange: (next: Set<string>) => void }) {
  const servers = useMcp((s) => s.servers).filter((s) => s.status === 'connected' && s.tools.length > 0)
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (servers.length === 0) {
    return <p className="text-[11px] text-muted-foreground">{t('No connected MCP server. Add one in the MCP screen.')}</p>
  }
  const set = (names: string[], on: boolean) => {
    const next = new Set(value)
    for (const n of names) {
      if (on) next.add(n)
      else next.delete(n)
    }
    onChange(next)
  }
  // What the chosen tools cost in context on every request (chantier 8 measures the rest).
  const chosen = servers.flatMap((s) => s.tools).filter((tool) => value.has(tool.qualifiedName))
  const tokens = estimateTokens(chosen.reduce((n, tool) => n + tool.chars, 0))
  const heavy = tokens > TOOL_TOKENS_WARNING || chosen.length > TOOL_COUNT_WARNING
  return (
    <div className="space-y-1.5">
      {chosen.length > 0 && (
        <p className={cn('flex items-start gap-1 text-[11px]', heavy ? 'text-warning' : 'text-muted-foreground')} role={heavy ? 'alert' : undefined}>
          {heavy && <TriangleAlert className="mt-px size-3 shrink-0" />}
          {heavy
            ? t('{count} tools, about {tokens} tokens of definitions sent with every request. Keep only what this agent needs.', { count: chosen.length, tokens })
            : t('{count} tools, about {tokens} tokens of definitions per request.', { count: chosen.length, tokens })}
        </p>
      )}
      {servers.map((server) => {
        const names = server.tools.map((t) => t.qualifiedName)
        const count = names.filter((n) => value.has(n)).length
        const expanded = open.has(server.id)
        return (
          <div key={server.id} className="rounded-lg border text-xs">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <input
                type="checkbox"
                aria-label={t('All tools of {server}', { server: server.name })}
                checked={count === names.length}
                ref={(el) => {
                  if (el) el.indeterminate = count > 0 && count < names.length
                }}
                onChange={(e) => set(names, e.target.checked)}
                className="accent-[var(--primary)]"
              />
              <button
                type="button"
                className="press press-soft flex min-w-0 flex-1 items-center gap-1.5 text-left"
                aria-expanded={expanded}
                onClick={() => {
                  const next = new Set(open)
                  if (expanded) next.delete(server.id)
                  else next.add(server.id)
                  setOpen(next)
                }}
              >
                <span className="truncate font-medium">{server.name}</span>
                <span className="text-muted-foreground">
                  {count}/{names.length}
                </span>
                <ChevronRight className={cn('ml-auto size-3 transition-transform', expanded && 'rotate-90')} />
              </button>
            </div>
            {expanded && (
              <ul className="space-y-1 border-t px-3 py-1.5">
                {server.tools.map((tool) => (
                  <li key={tool.qualifiedName}>
                    <label className="flex cursor-pointer items-start gap-2" title={tool.description}>
                      <input
                        type="checkbox"
                        checked={value.has(tool.qualifiedName)}
                        onChange={(e) => set([tool.qualifiedName], e.target.checked)}
                        className="mt-0.5 accent-[var(--primary)]"
                      />
                      <span className="min-w-0">
                        <span className="font-mono">{tool.name}</span>
                        {tool.description && <span className="block truncate text-muted-foreground">{tool.description}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The three permission levels as radio cards, with the hint for the account's kind. */
export function PermissionPicker({
  value,
  onChange,
  kind,
  name
}: {
  value: PermissionLevel
  onChange: (level: PermissionLevel) => void
  kind: ProfileKind | undefined
  name: string
}) {
  return (
    <div className="grid gap-1.5" role="radiogroup" aria-label={t('Permissions')}>
      {PERMISSION_LEVELS.map((l) => (
        <label
          key={l}
          className={cn(
            'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-1.5 text-xs transition-colors',
            value === l ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
          )}
        >
          <input type="radio" name={name} value={l} checked={value === l} onChange={() => onChange(l)} className="mt-0.5 accent-[var(--primary)]" />
          <span>
            <span className="block font-medium">{t(PERMISSION_LEVEL_LABELS[l])}</span>
            <span className="block text-[11px] text-muted-foreground">{kind === 'antigravity' ? t(ANTIGRAVITY_LEVEL_HINTS[l]) : t(LEVEL_HINTS[l])}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

export interface SessionSettingsValue {
  permissionLevel: PermissionLevel
  mcpTools: string[]
  systemPrompt: string
}

/** Permissions, MCP tools and system prompt of the next session, behind one small button. */
export function SessionSettingsPopover({
  value,
  onChange,
  kind
}: {
  value: SessionSettingsValue
  onChange: (next: SessionSettingsValue) => void
  kind: ProfileKind | undefined
}) {
  return (
    <Popover>
      <PopoverTrigger
        className="press flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t('Session settings')}
        title={t('Session settings')}
      >
        <SlidersHorizontal className="size-3.5" />
        <span className="max-w-28 truncate">{t(PERMISSION_LEVEL_LABELS[value.permissionLevel])}</span>
        {value.mcpTools.length > 0 && (
          <span className="flex items-center gap-0.5">
            · <Plug className="size-3" />
            {value.mcpTools.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 overflow-y-auto p-3" data-testid="session-settings">
        <section className="space-y-1.5">
          <h3 className="text-xs font-medium">{t('Permissions')}</h3>
          <PermissionPicker value={value.permissionLevel} onChange={(permissionLevel) => onChange({ ...value, permissionLevel })} kind={kind} name="next-permission" />
        </section>
        <section className="space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-medium">
            <Plug className="size-3.5" /> {t('MCP tools')}
            {value.mcpTools.length > 0 && (
              <span className="font-normal text-muted-foreground">· {tn('{count} allowed', '{count} allowed', value.mcpTools.length)}</span>
            )}
          </h3>
          <McpPicker value={new Set(value.mcpTools)} onChange={(next) => onChange({ ...value, mcpTools: [...next] })} />
        </section>
        <section className="space-y-1.5">
          <h3 className="text-xs font-medium">{t('System prompt')}</h3>
          <textarea
            value={value.systemPrompt}
            onChange={(e) => onChange({ ...value, systemPrompt: e.target.value })}
            placeholder={t('Added to the default instructions, e.g. “Answer in French. Run the tests before saying you are done.”')}
            aria-label={t('System prompt')}
            className="min-h-20 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </section>
      </PopoverContent>
    </Popover>
  )
}
