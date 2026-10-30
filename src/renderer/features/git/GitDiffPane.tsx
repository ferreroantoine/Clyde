import { useEffect, useState } from 'react'
import { Bot, ClipboardCopy, Columns2, FileText, FileWarning, GitBranch, LoaderCircle, Minus, Plus, Rows3, Undo2, X, CopyPlus } from 'lucide-react'
import { t } from '@shared/i18n'
import type { GitCommit, GitDiffMode, GitFileChange, GitFileDiff, GitHunk } from '@shared/git'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useGit, type GitView } from '@/stores/git'
import { notify } from '@/stores/notifications'
import { IconButton } from '@/components/IconButton'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { DiffView } from './DiffView'
import { FileIcon } from '@/features/explorer/FileIcon'
import { checkout, copyText, dateTime, dirOf, discard, explainCommit, nameOf, openFile, pick, STATE_COLOR, STATE_LETTER } from './actions'

/** The editor area while a change or a commit is open from the Source view. */
export function GitDiffPane() {
  const view = useGit((s) => s.view)
  if (!view) return null
  return view.kind === 'change' ? <ChangeDiff view={view} /> : <CommitDetail commit={view.commit} path={view.path} />
}

function Body({ diff, error }: { diff: GitFileDiff | null; error: string | null }) {
  if (error) return <EmptyState icon={FileWarning} title={t('Could not show the change')} description={error} />
  if (!diff) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    )
  }
  if (diff.unsupported) return <EmptyState icon={FileWarning} title={t('Binary or large file')} description={t('This change cannot be shown as text.')} />
  return <DiffView diff={diff} />
}

function ChangeDiff({ view }: { view: Extract<GitView, { kind: 'change' }> }) {
  const status = useGit((s) => s.status)
  const show = useGit((s) => s.show)
  const run = useGit((s) => s.run)
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [layout, setLayout] = useState<'side' | 'hunks'>('side')
  const { path, mode, oldPath } = view

  // Reloaded whenever the repository changes (a hunk staged, the file saved).
  useEffect(() => {
    let live = true
    invoke('git:diff', { path, mode, ...(oldPath ? { oldPath } : {}) })
      .then((d) => {
        if (!live) return
        setDiff(d)
        setError(null)
      })
      .catch((err: Error) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [path, mode, oldPath, status])

  // Once the file has nothing left on this side, the view goes to the other side or closes.
  useEffect(() => {
    if (!status) return
    const here = mode === 'staged' ? status.staged : [...status.unstaged, ...status.untracked]
    if (here.some((c) => c.path === path)) return
    const other = mode === 'staged' ? [...status.unstaged, ...status.untracked] : status.staged
    const next = other.find((c) => c.path === path)
    show(next ? { kind: 'change', path, mode: mode === 'staged' ? 'unstaged' : 'staged', oldPath: next.oldPath } : null)
  }, [status, path, mode, show])

  const untracked = status?.untracked.some((c) => c.path === path) ?? false
  const hunk = (index: number, action: 'stage' | 'unstage' | 'discard') => {
    if (action === 'discard' && !window.confirm(t('Discard this part of the change? This cannot be undone.'))) return
    void run('hunk', t('Could not change this part'), () => invoke('git:applyHunk', { path, mode, index, action }))
  }

  return (
    <div className="flex h-full flex-col bg-editor">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b bg-chrome px-3 text-xs">
        <FileIcon name={nameOf(path)} className="size-3.5" />
        <span className="font-medium">{nameOf(path)}</span>
        <span className="min-w-0 truncate text-muted-foreground">{oldPath ? `${oldPath} → ${dirOf(path)}` : dirOf(path)}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {mode === 'staged' ? t('Staged · last commit ↔ staged') : t('Working tree · staged ↔ file')}
        </span>
        <span className="flex-1" />
        <IconButton icon={layout === 'side' ? Rows3 : Columns2} label={layout === 'side' ? t('Show by parts, to stage some of them') : t('Show side by side')} onClick={() => setLayout(layout === 'side' ? 'hunks' : 'side')} />
        <IconButton icon={FileText} label={t('Open file')} onClick={() => openFile(path)} />
        {mode === 'unstaged' ? (
          <>
            <IconButton icon={Undo2} label={untracked ? t('Delete') : t('Discard changes')} onClick={() => void discard([path], untracked ? 1 : 0)} />
            <IconButton icon={Plus} label={t('Stage file')} onClick={() => void run('stage', t('Could not stage'), () => invoke('git:stage', { paths: [path] }))} />
          </>
        ) : (
          <IconButton icon={Minus} label={t('Unstage file')} onClick={() => void run('unstage', t('Could not unstage'), () => invoke('git:unstage', { paths: [path] }))} />
        )}
        <IconButton icon={X} label={t('Close')} onClick={() => show(null)} />
      </header>
      <div className="min-h-0 flex-1">
        {layout === 'hunks' && diff && !diff.unsupported ? <Hunks hunks={diff.hunks} mode={mode} untracked={untracked} onAction={hunk} /> : <Body diff={diff} error={error} />}
      </div>
    </div>
  )
}

function Hunks({ hunks, mode, untracked, onAction }: { hunks: GitHunk[]; mode: GitDiffMode; untracked: boolean; onAction: (index: number, action: 'stage' | 'unstage' | 'discard') => void }) {
  if (untracked) return <EmptyState icon={FileText} title={t('New file')} description={t('A new file is staged as a whole.')} />
  if (!hunks.length) return <EmptyState icon={FileText} title={t('No text change')} description={t('Only the file mode or line endings changed.')} />
  return (
    <div className="h-full overflow-auto p-3 font-mono text-[12px]">
      {hunks.map((h, i) => (
        <div key={`${i}:${h.header}`} className="mb-3 overflow-hidden rounded-md border">
          <div className="flex items-center gap-2 border-b bg-muted/60 px-2 py-1 font-sans text-[11px]">
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{h.header}</span>
            {mode === 'unstaged' ? (
              <>
                <Button size="xs" variant="ghost" onClick={() => onAction(i, 'discard')}>
                  <Undo2 />
                  {t('Discard')}
                </Button>
                <Button size="xs" variant="outline" onClick={() => onAction(i, 'stage')}>
                  <Plus />
                  {t('Stage this part')}
                </Button>
              </>
            ) : (
              <Button size="xs" variant="outline" onClick={() => onAction(i, 'unstage')}>
                <Minus />
                {t('Unstage this part')}
              </Button>
            )}
          </div>
          <pre className="overflow-x-auto py-1">
            {h.lines.map((line, n) => (
              <div
                key={n}
                className={cn('px-2 whitespace-pre', line.startsWith('+') && 'bg-success/15', line.startsWith('-') && 'bg-destructive/15', line.startsWith('\\') && 'text-muted-foreground italic')}
              >
                {line || ' '}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  )
}

function CommitDetail({ commit, path }: { commit: GitCommit; path: string | null }) {
  const show = useGit((s) => s.show)
  // Each result remembers what it was loaded for, so a stale one is never shown.
  const [loadedFiles, setFiles] = useState<{ hash: string; files: GitFileChange[] } | null>(null)
  const [loadedDiff, setDiff] = useState<{ key: string; diff: GitFileDiff | null; error: string | null } | null>(null)
  const files = loadedFiles?.hash === commit.hash ? loadedFiles.files : null

  useEffect(() => {
    let live = true
    invoke('git:commitFiles', { hash: commit.hash })
      .then((list) => {
        if (!live) return
        setFiles({ hash: commit.hash, files: list })
        // The first file opens by itself.
        if (!path && list[0]) show({ kind: 'commit', commit, path: list[0].path })
      })
      .catch((err) => notify.error(t('Could not read the commit'), err))
    return () => {
      live = false
    }
    // `path` changes as files are picked; the list only depends on the commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit.hash])

  const file = files?.find((f) => f.path === path) ?? null
  const key = file ? `${commit.hash}:${file.path}` : ''
  const shown = loadedDiff?.key === key ? loadedDiff : null
  useEffect(() => {
    if (!file) return
    let live = true
    const key = `${commit.hash}:${file.path}`
    invoke('git:commitDiff', { hash: commit.hash, path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}) })
      .then((diff) => live && setDiff({ key, diff, error: null }))
      .catch((err: Error) => live && setDiff({ key, diff: null, error: err.message }))
    return () => {
      live = false
    }
  }, [commit.hash, file])

  return (
    <div className="flex h-full flex-col bg-editor">
      <header className="flex shrink-0 flex-col gap-1 border-b bg-chrome px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{commit.subject}</span>
          <IconButton icon={Bot} label={t('Explain this commit with the agent')} onClick={() => explainCommit(commit)} />
          <IconButton icon={GitBranch} label={t('Check out this commit')} onClick={() => void checkout(commit.hash)} />
          <IconButton icon={CopyPlus} label={t('Cherry-pick')} onClick={() => void pick('cherry-pick', commit)} />
          <IconButton icon={Undo2} label={t('Revert')} onClick={() => void pick('revert', commit)} />
          <IconButton icon={X} label={t('Close')} onClick={() => show(null)} />
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <button type="button" className="flex items-center gap-1 font-mono hover:text-foreground" onClick={() => copyText(commit.hash)} title={t('Copy hash')}>
            {commit.short}
            <ClipboardCopy className="size-3" />
          </button>
          <span>·</span>
          <span title={commit.email}>{commit.author}</span>
          <span>·</span>
          <span>{dateTime(commit.date)}</span>
          {commit.parents.length > 1 && <span>· {t('merge of {count} parents', { count: commit.parents.length })}</span>}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <ul className="w-64 shrink-0 overflow-y-auto border-r bg-chrome py-1">
          {files === null && <li className="px-3 py-1 text-xs text-muted-foreground">{t('Loading…')}</li>}
          {files?.length === 0 && <li className="px-3 py-1 text-xs text-muted-foreground">{t('No file changes')}</li>}
          {files?.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => show({ kind: 'commit', commit, path: f.path })}
                title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                className={cn('flex h-6 w-full items-center gap-1.5 px-2 text-left text-[12px] hover:bg-accent/70', f.path === path && 'bg-accent')}
              >
                <FileIcon name={nameOf(f.path)} className="size-3.5" />
                <span className="truncate">{nameOf(f.path)}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{dirOf(f.path)}</span>
                <span className={cn('w-3 font-mono text-[11px] font-semibold', STATE_COLOR[f.state])}>{STATE_LETTER[f.state]}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1">{file ? <Body diff={shown?.diff ?? null} error={shown?.error ?? null} /> : null}</div>
      </div>
    </div>
  )
}
