import { useState, type ReactNode } from 'react'
import { PERMISSION_LEVELS, PERMISSION_LEVEL_LABELS, type PermissionLevel } from '@shared/agent'
import type { AgentDefinition } from '@shared/tasks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ProfileBadge } from '@/components/ProfileBadge'
import { LEVEL_HINTS, McpPicker } from '@/features/agent-panel/NewSession'
import { useBoard } from '@/stores/board'
import { useProfiles } from '@/stores/profiles'
import { cn } from '@/lib/utils'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </div>
  )
}

export function AgentDialog({ open, onOpenChange, agent }: { open: boolean; onOpenChange: (o: boolean) => void; agent?: AgentDefinition }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <AgentForm {...(agent ? { agent } : {})} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function AgentForm({ agent, close }: { agent?: AgentDefinition; close: () => void }) {
  const profiles = useProfiles((s) => s.profiles).filter((p) => p.usable)
  const tests = useProfiles((s) => s.tests)
  const saveAgent = useBoard((s) => s.saveAgent)
  const [name, setName] = useState(agent?.name ?? '')
  const [profileId, setProfileId] = useState(agent?.profileId ?? profiles[0]?.id ?? '')
  const [model, setModel] = useState(agent?.model ?? '')
  const [level, setLevel] = useState<PermissionLevel>(agent?.permissionLevel ?? 'files-auto')
  const [prompt, setPrompt] = useState(agent?.systemPrompt ?? '')
  const [mcpTools, setMcpTools] = useState(new Set(agent?.mcpTools ?? []))
  const test = tests[profileId]
  const models = test && test !== 'testing' ? test.models : []

  const save = async () => {
    const input = { name, profileId, model, permissionLevel: level, systemPrompt: prompt, mcpTools: [...mcpTools] }
    const saved = await saveAgent(agent ? { id: agent.id, ...input } : input)
    if (saved) close()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{agent ? `Edit ${agent.name}` : 'New agent'}</DialogTitle>
        <DialogDescription>An agent is an account, a model, instructions, a permission level and its MCP tools.</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() && profileId) void save()
        }}
      >
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Reviewer" maxLength={60} />
        </Field>
        <Field label="Account">
          <div className="grid gap-1.5" role="radiogroup" aria-label="Account">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={profileId === p.id}
                onClick={() => setProfileId(p.id)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-left text-xs',
                  profileId === p.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/60'
                )}
              >
                <ProfileBadge profile={p} />
              </button>
            ))}
            {profiles.length === 0 && <p className="text-xs text-muted-foreground">Add an account first.</p>}
          </div>
        </Field>
        <Field label="Model">
          <Input list="agent-def-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" className="font-mono text-xs" />
          <datalist id="agent-def-models">
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.displayName}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label="Permissions">
          <div className="grid gap-1.5">
            {PERMISSION_LEVELS.map((l) => (
              <label key={l} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-1.5 text-xs', level === l && 'border-primary bg-primary/5')}>
                <input type="radio" name="agent-level" checked={level === l} onChange={() => setLevel(l)} className="mt-0.5 accent-[var(--primary)]" />
                <span>
                  <span className="block font-medium">{PERMISSION_LEVEL_LABELS[l]}</span>
                  <span className="block text-[11px] text-muted-foreground">{LEVEL_HINTS[l]}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="MCP tools">
          <McpPicker value={mcpTools} onChange={setMcpTools} />
        </Field>
        <Field label="System prompt">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="How this agent works, e.g. “Write tests first. Keep changes small.”"
            aria-label="System prompt"
            className="min-h-20 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || !profileId}>
            {agent ? 'Save' : 'Create agent'}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
