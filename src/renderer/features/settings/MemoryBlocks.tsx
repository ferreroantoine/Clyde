import { useEffect, useState } from 'react'
import { Check, FilePlus, FolderOpen, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { t, tn } from '@shared/i18n'
import { lineDiff, type MemoryDocView, type MemoryProposal, type MemoryScope } from '@shared/memory'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMemory } from '@/stores/memory'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/utils'

const tokens = (text: string) => Math.ceil(text.length / 4)

const AREA =
  'w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Loads the memory once a memory block is on screen, and again when the project changes. */
function useMemoryState() {
  const state = useMemory((s) => s.state)
  const load = useMemory((s) => s.load)
  const root = useWorkspace((s) => s.info?.root ?? null)
  useEffect(() => {
    void load()
  }, [load, root])
  return state
}

/** The core of one scope: loaded in every session, so its size is shown against the budget. */
export function MemoryCoreBlock({ scope }: { scope: MemoryScope }) {
  const state = useMemoryState()
  const saveCore = useMemory((s) => s.saveCore)
  const consolidate = useMemory((s) => s.consolidate)
  const open = useMemory((s) => s.open)
  const busy = useMemory((s) => s.busy.includes(scope))
  const part = scope === 'user' ? state?.user : state?.project
  const saved = part?.core ?? ''
  const [draft, setDraft] = useState(saved)
  const [prev, setPrev] = useState(saved)
  // A save elsewhere (an accepted proposal) replaces the text, unless it is being edited.
  if (prev !== saved) {
    setPrev(saved)
    if (draft === prev) setDraft(saved)
  }
  if (!state) return null
  if (!part) return <p className="text-xs text-muted-foreground">{t('Open a folder to give this project a memory.')}</p>

  const other = scope === 'user' ? (state.project?.tokens ?? 0) : state.user.tokens
  const used = tokens(draft) + other
  const over = used > state.budget
  const dirty = draft !== saved
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{scope === 'user' ? t('About you') : t('This project')}</p>
          <p className="truncate text-xs text-muted-foreground" title={part.dir}>
            {scope === 'user'
              ? t('Sent to every account (CLAUDE.md, AGENTS.md, GEMINI.md of each account), never into a repository.')
              : t('In {path}, copied into the project’s CLAUDE.md and AGENTS.md (and GEMINI.md when there is one).', { path: '.clyde/memory' })}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void open(scope)}>
            <FolderOpen /> {t('Open folder')}
          </Button>
          <Button size="sm" variant="outline" loading={busy} disabled={!saved.trim() || dirty} onClick={() => void consolidate(scope)}>
            <Sparkles /> {t('Consolidate')}
          </Button>
        </div>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={scope === 'user' ? t('About you') : t('This project')}
        placeholder={scope === 'user' ? t('- I prefer short answers.\n- My name is…') : t('- Package manager: pnpm.\n- Run the tests with: pnpm test')}
        rows={8}
        className={AREA}
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn('text-xs tabular-nums', over ? 'text-warning' : 'text-muted-foreground')} data-testid={`memory-tokens-${scope}`}>
          {t('About {used} of {budget} tokens for both cores, in every session.', { used: used.toLocaleString(), budget: state.budget.toLocaleString() })}
          {over && ` ${t('Over budget: move details into notes, or consolidate.')}`}
        </p>
        <div className="flex gap-1.5">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
              {t('Discard')}
            </Button>
          )}
          <Button size="sm" disabled={!dirty} onClick={() => void saveCore(scope, draft)}>
            {t('Save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function DocEditor({ scope, doc, onDone }: { scope: MemoryScope; doc: MemoryDocView | null; onDone: () => void }) {
  const saveDoc = useMemory((s) => s.saveDoc)
  const [title, setTitle] = useState(doc?.title ?? '')
  const [content, setContent] = useState(doc?.content ?? '')
  const save = async () => {
    // The first line is the title the index shows; keep the two in step.
    const body = content.trim() ? content : `# ${title}\n`
    const text = /^#\s/.test(body) ? body.replace(/^#\s.*$/m, `# ${title.trim()}`) : `# ${title.trim()}\n\n${body}`
    if (await saveDoc(scope, doc?.name ?? null, title, text)) onDone()
  }
  return (
    <div className="space-y-2 rounded-md border p-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Release process')} aria-label={t('Note title')} maxLength={120} autoFocus />
      <textarea value={content} onChange={(e) => setContent(e.target.value)} aria-label={t('Note content')} rows={8} className={AREA} spellCheck={false} />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('Cancel')}
        </Button>
        <Button size="sm" disabled={!title.trim()} onClick={() => void save()}>
          {t('Save')}
        </Button>
      </div>
    </div>
  )
}

/** Detailed notes: only their titles reach the prompt; an agent reads one when it needs it. */
export function MemoryDocsBlock({ scope }: { scope: MemoryScope }) {
  const state = useMemoryState()
  const deleteDoc = useMemory((s) => s.deleteDoc)
  const [editing, setEditing] = useState<string | null>(null)
  const part = scope === 'user' ? state?.user : state?.project
  if (!part) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {tn('{count} note. Agents see its title and read it only when the task needs it.', '{count} notes. Agents see their titles and read one only when the task needs it.', part.docs.length)}
        </p>
        <Button size="sm" variant="outline" onClick={() => setEditing('')}>
          <FilePlus /> {t('New note')}
        </Button>
      </div>
      {editing === '' && <DocEditor scope={scope} doc={null} onDone={() => setEditing(null)} />}
      <ul className="divide-y rounded-md border empty:hidden">
        {part.docs.map((doc) =>
          editing === doc.name ? (
            <li key={doc.name} className="p-2">
              <DocEditor scope={scope} doc={doc} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={doc.name} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{doc.title}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {doc.name} · {tn('{count} token', '{count} tokens', tokens(doc.content))}
                </p>
              </div>
              <Button size="icon-xs" variant="ghost" aria-label={t('Edit {name}', { name: doc.title })} onClick={() => setEditing(doc.name)}>
                <Pencil />
              </Button>
              <Button size="icon-xs" variant="ghost" aria-label={t('Delete {name}', { name: doc.title })} onClick={() => void deleteDoc(scope, doc.name)}>
                <Trash2 />
              </Button>
            </li>
          )
        )}
      </ul>
    </div>
  )
}

function Proposal({ proposal }: { proposal: MemoryProposal }) {
  const accept = useMemory((s) => s.accept)
  const reject = useMemory((s) => s.reject)
  const [edit, setEdit] = useState<string | null>(null)
  const diff = lineDiff(proposal.before.trimEnd(), proposal.after.trimEnd())
  return (
    <li className="space-y-2 rounded-md border p-3" data-testid="memory-proposal">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {proposal.scope === 'user' ? t('About you') : t('This project')}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {proposal.kind === 'consolidate' ? t('Consolidation') : t('After a session')} · {new Date(proposal.createdAt).toLocaleString()}
          </span>
        </p>
      </div>
      {proposal.reason && <p className="text-xs text-muted-foreground">{proposal.reason}</p>}
      {edit === null ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs leading-relaxed">
          {diff.map((line, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap',
                line.kind === 'add' && 'bg-success/15 text-success',
                line.kind === 'remove' && 'bg-destructive/10 text-destructive line-through decoration-destructive/40'
              )}
            >
              {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '− ' : '  '}
              {line.text}
            </div>
          ))}
        </pre>
      ) : (
        <textarea value={edit} onChange={(e) => setEdit(e.target.value)} aria-label={t('Proposed memory')} rows={8} className={AREA} spellCheck={false} />
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => void reject(proposal.id)}>
          <X /> {t('Dismiss')}
        </Button>
        {edit === null && (
          <Button size="sm" variant="outline" onClick={() => setEdit(proposal.after)}>
            <Pencil /> {t('Edit')}
          </Button>
        )}
        <Button size="sm" onClick={() => void accept(proposal.id, edit ?? undefined)}>
          <Check /> {t('Apply')}
        </Button>
      </div>
    </li>
  )
}

/** Changes agents proposed: nothing reaches the memory before the user applies it. */
export function MemoryProposalsBlock() {
  const state = useMemoryState()
  const proposals = state?.proposals ?? []
  if (proposals.length === 0) return <p className="text-xs text-muted-foreground">{t('No proposal to review.')}</p>
  return (
    <ul className="space-y-2">
      {proposals.map((p) => (
        <Proposal key={p.id} proposal={p} />
      ))}
    </ul>
  )
}
