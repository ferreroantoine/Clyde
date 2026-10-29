import { useState } from 'react'
import { t, tn } from '@shared/i18n'
import { ArrowLeft, CircleAlert, GitBranch, GitMerge, LoaderCircle, MessageSquareReply, Trash2 } from 'lucide-react'
import type { Task, TaskChange } from '@shared/tasks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/EmptyState'
import { useBoard } from '@/stores/board'
import { cn } from '@/lib/utils'
import { DiffView } from './DiffView'

const STATUS_LETTER: Record<TaskChange['status'], { letter: string; className: string }> = {
  added: { letter: 'A', className: 'text-success' },
  modified: { letter: 'M', className: 'text-warning' },
  deleted: { letter: 'D', className: 'text-destructive' },
  renamed: { letter: 'R', className: 'text-primary' }
}

export function ReviewView({ task }: { task: Task }) {
  const review = useBoard((s) => s.review)
  const busy = useBoard((s) => !!s.busy[task.id])
  const selectFile = useBoard((s) => s.selectFile)
  const closeReview = useBoard((s) => s.closeReview)
  const merge = useBoard((s) => s.merge)
  const abandon = useBoard((s) => s.abandon)
  const requestChanges = useBoard((s) => s.requestChanges)
  const [asking, setAsking] = useState(false)
  const [comments, setComments] = useState('')
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const changes = review?.changes ?? []

  return (
    <div className="flex h-full min-h-0 flex-col" data-review={task.id}>
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <Button size="icon-xs" variant="ghost" aria-label={t('Back to the board')} onClick={closeReview}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{task.title}</h2>
          <p className="flex min-w-0 items-center gap-1.5 text-[11px] whitespace-nowrap text-muted-foreground">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate font-mono" title={task.branch}>
              {task.branch}
            </span>
            <span className="shrink-0">
              → <span className="font-mono">{task.baseBranch}</span>
              {review?.changes && ` · ${tn('{count} file changed', '{count} files changed', changes.length)}`}
            </span>
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmAbandon(true)}>
            <Trash2 /> {' '}{t('Abandon')}</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsking(true)}>
            <MessageSquareReply /> {' '}{t('Request changes')}</Button>
          <Button size="sm" disabled={busy || changes.length === 0} onClick={() => void merge(task.id)}>
            {busy ? <LoaderCircle className="animate-spin" /> : <GitMerge />} {t('Merge into {branch}', { branch: task.baseBranch })}
          </Button>
        </div>
      </header>
      {task.note && (
        <p className="flex shrink-0 items-start gap-1.5 border-b bg-warning/10 px-4 py-2 text-xs">
          <CircleAlert className="mt-px size-3.5 shrink-0 text-warning" />
          {task.note}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <nav className="w-64 shrink-0 overflow-y-auto border-r py-1" aria-label={t('Changed files')}>
          {review?.loading && !review.changes && (
            <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" /> {' '}{t('Reading the changes…')}</p>
          )}
          {changes.map((c) => {
            const s = STATUS_LETTER[c.status]
            return (
              <button
                key={c.path}
                type="button"
                title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
                onClick={() => void selectFile(c.path)}
                aria-current={review?.selected === c.path}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-accent/60',
                  review?.selected === c.path && 'bg-accent'
                )}
              >
                <span className={cn('w-3 shrink-0 font-mono font-semibold', s.className)}>{s.letter}</span>
                <span className="truncate font-mono">{c.path}</span>
              </button>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1">
          {review?.changes && changes.length === 0 ? (
            <EmptyState icon={GitBranch} title={t('No changes')} description={t('The agent has not changed any file in this worktree yet.')} />
          ) : review?.diff?.unsupported ? (
            <EmptyState icon={GitBranch} title={t('Binary or large file')} description={t('This file cannot be shown as a text diff.')} />
          ) : review?.diff ? (
            <DiffView diff={review.diff} />
          ) : null}
        </div>
      </div>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('Request changes')}</DialogTitle>
            <DialogDescription>{t('The agent continues in the same worktree with your comments as its next message.')}</DialogDescription>
          </DialogHeader>
          <textarea
            autoFocus
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={t('What should change?')}
            aria-label={t('Review comments')}
            className="min-h-32 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t('Cancel')}</Button>
            <Button
              disabled={!comments.trim() || busy}
              onClick={() => void requestChanges(task.id, comments).then((ok) => ok && setAsking(false))}
            >
              {t('Send to the agent')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmAbandon} onOpenChange={setConfirmAbandon}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('Abandon this task?')}</DialogTitle>
            <DialogDescription>
              {t('The worktree and the branch')}{' '}<span className="font-mono">{task.branch}</span> {' '}{t('are deleted, with every change in them.')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmAbandon(false)}>
              {t('Keep it')}</Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmAbandon(false)
                void abandon(task.id)
              }}
            >
              {t('Abandon')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
