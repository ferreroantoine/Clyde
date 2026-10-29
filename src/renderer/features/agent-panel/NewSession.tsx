import { useState } from 'react'
import { t, tk } from '@shared/i18n'
import { ChevronRight, FolderGit2, KeyRound, Play, Plug } from 'lucide-react'
import { ANTIGRAVITY_LEVEL_HINTS, PERMISSION_LEVELS, PERMISSION_LEVEL_LABELS, type PermissionLevel } from '@shared/agent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { ProfileBadge } from '@/components/ProfileBadge'
import { useAgents } from '@/stores/agents'
import { useMcp } from '@/stores/mcp'
import { useLayout } from '@/stores/layout'
import { useSettings } from '@/stores/settings'
import { useProfiles } from '@/stores/profiles'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'
import { PROFILE_KIND_LABELS } from '@shared/profiles'

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
  return (
    <div className="space-y-1.5">
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

export function NewSession() {
  const profiles = useProfiles((s) => s.profiles).filter((p) => p.usable)
  const tests = useProfiles((s) => s.tests)
  const workspace = useWorkspace((s) => s.info)
  const start = useAgents((s) => s.start)
  const starting = useAgents((s) => s.starting)
  const showSettings = useLayout((s) => s.showSettings)

  const [profileId, setProfileId] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [level, setLevel] = useState<PermissionLevel>(() => useSettings.getState().settings.agents.defaultPermission)
  const [mcpTools, setMcpTools] = useState<Set<string>>(new Set())
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const selected = profiles.find((p) => p.id === profileId) ?? profiles[0]
  const test = selected ? tests[selected.id] : undefined
  const models = test && test !== 'testing' ? test.models : []

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title={t('No account yet')}
        description={t('Add an account, then start an agent to chat with it here. Tool calls and approvals show up inline.')}
        action={
          <Button size="sm" variant="outline" onClick={() => showSettings('accounts')}>
            {t('Open Accounts')}</Button>
        }
      />
    )
  }

  return (
    <form
      className="flex h-full flex-col gap-5 overflow-y-auto p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (selected) {
          void start({ profileId: selected.id, model, permissionLevel: level, mcpTools: [...mcpTools], systemPrompt })
        }
      }}
    >
      <div>
        <h2 className="text-sm font-semibold">{t('New agent session')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('Choose the account explicitly; Atelier never switches it for you.')}</p>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs font-medium">{t('Account')}</legend>
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={selected?.id === p.id}
            onClick={() => {
              setProfileId(p.id)
              setModel('')
            }}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
              selected?.id === p.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
            )}
          >
            <ProfileBadge profile={p} className="font-medium" />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {p.kind === 'claude-code' ? (p.auth === 'subscription' ? 'Claude Code' : t('Claude Code · key')) : PROFILE_KIND_LABELS[p.kind]}
            </span>
          </button>
        ))}
      </fieldset>

      <label className="grid gap-1.5">
        <span className="text-xs font-medium">{t('Model')}</span>
        <Input
          list="agent-models"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={selected?.defaultModel || 'default'}
          className="h-8 font-mono text-xs"
        />
        <datalist id="agent-models">
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.displayName}
            </option>
          ))}
        </datalist>
      </label>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs font-medium">{t('Permissions')}</legend>
        {PERMISSION_LEVELS.map((l) => (
          <label
            key={l}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors',
              level === l ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
            )}
          >
            <input
              type="radio"
              name="permission-level"
              value={l}
              checked={level === l}
              onChange={() => setLevel(l)}
              className="mt-0.5 accent-[var(--primary)]"
            />
            <span>
              <span className="block font-medium">{t(PERMISSION_LEVEL_LABELS[l])}</span>
              <span className="block text-[11px] text-muted-foreground">
                {selected?.kind === 'antigravity' ? t(ANTIGRAVITY_LEVEL_HINTS[l]) : t(LEVEL_HINTS[l])}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
          <Plug className="size-3.5" /> {t('MCP tools')}
          {mcpTools.size > 0 && <span className="font-normal text-muted-foreground">· {t('{count} allowed', { count: mcpTools.size })}</span>}
        </legend>
        <McpPicker value={mcpTools} onChange={setMcpTools} />
      </fieldset>

      <div className="space-y-1.5">
        <button
          type="button"
          aria-expanded={showPrompt}
          onClick={() => setShowPrompt(!showPrompt)}
          className="press flex items-center gap-1 text-xs font-medium"
        >
          <ChevronRight className={cn('size-3 transition-transform', showPrompt && 'rotate-90')} />
          {t('System prompt')}
          {systemPrompt.trim() && <span className="font-normal text-muted-foreground">· {t('set')}</span>}
        </button>
        {showPrompt && (
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={t('Added to the default instructions, e.g. “Answer in French. Run the tests before saying you are done.”')}
            aria-label={t('System prompt')}
            className="min-h-20 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
      </div>

      <div className="mt-auto space-y-2">
        <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
          <FolderGit2 className="size-3.5 shrink-0" />
          {workspace ? <span className="truncate">{t('Works in {folder}', { folder: workspace.root })}</span> : t('Open a folder first: the agent works inside it.')}
        </p>
        <Button type="submit" className="w-full" disabled={!workspace || !selected || starting}>
          <Play /> {starting ? t('Starting…') : t('Start agent')}
        </Button>
      </div>
    </form>
  )
}
