import { useEffect, useMemo } from 'react'
import { Bot, ClipboardCopy, GitBranch, GitBranchPlus, GitCommitHorizontal, RefreshCw, Undo2, CopyPlus } from 'lucide-react'
import { t } from '@shared/i18n'
import type { GitCommit } from '@shared/git'
import { graphRows, type GraphRow } from '@/lib/git-graph'
import { cn } from '@/lib/utils'
import { useGit } from '@/stores/git'
import { IconButton } from '@/components/IconButton'
import { Skeleton } from '@/components/Skeleton'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { checkout, copyText, createBranch, dateTime, explainCommit, pick } from './actions'

const ROW = 26
const LANE = 12
/** Lane colors, cycling. */
export const LANE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16']
const laneColor = (n: number) => LANE_COLORS[n % LANE_COLORS.length] as string
const x = (lane: number) => LANE / 2 + lane * LANE

function Graph({ row, width }: { row: GraphRow; width: number }) {
  const mid = ROW / 2
  return (
    <svg width={width * LANE} height={ROW} className="shrink-0" aria-hidden>
      {row.segments.map((s, i) => {
        const [y1, y2] = s.kind === 'in' ? [0, mid] : s.kind === 'out' ? [mid, ROW] : [0, ROW]
        const d = s.from === s.to ? `M${x(s.from)} ${y1}V${y2}` : `M${x(s.from)} ${y1}C${x(s.from)} ${(y1 + y2) / 2} ${x(s.to)} ${(y1 + y2) / 2} ${x(s.to)} ${y2}`
        return <path key={i} d={d} stroke={laneColor(s.color)} strokeWidth={1.5} fill="none" />
      })}
      <circle cx={x(row.col)} cy={mid} r={3.5} fill={laneColor(row.color)} stroke="var(--color-chrome)" strokeWidth={1.5} />
    </svg>
  )
}

function RefChip({ name }: { name: string }) {
  const head = name.startsWith('HEAD -> ')
  const label = name.replace(/^HEAD -> /, '').replace(/^tag: /, '')
  const tag = name.startsWith('tag: ')
  const remote = !head && !tag && name.includes('/')
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 text-[10px] leading-4 font-medium',
        head ? 'bg-primary text-primary-foreground' : tag ? 'bg-warning/20 text-warning' : remote ? 'bg-muted text-muted-foreground' : 'bg-accent text-foreground'
      )}
    >
      {label}
    </span>
  )
}

function CommitRow({ commit, row, width, selected }: { commit: GitCommit; row: GraphRow; width: number; selected: boolean }) {
  const show = useGit((s) => s.show)
  const refs = commit.refs.filter((r) => r !== 'HEAD')
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => show({ kind: 'commit', commit, path: null })}
          onKeyDown={(e) => e.key === 'Enter' && show({ kind: 'commit', commit, path: null })}
          title={`${commit.short} · ${commit.author} · ${new Date(commit.date).toLocaleString()}\n${commit.subject}`}
          data-commit={commit.short}
          style={{ height: ROW }}
          className={cn('flex cursor-default items-center gap-1.5 pr-2 pl-1 text-[12px] outline-none hover:bg-accent/70 focus-visible:bg-accent', selected && 'bg-accent')}
        >
          <Graph row={row} width={width} />
          {refs.slice(0, 3).map((r) => (
            <RefChip key={r} name={r} />
          ))}
          <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{dateTime(commit.date)}</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem onSelect={() => explainCommit(commit)}>
          <Bot />
          {t('Explain this commit with the agent')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyText(commit.hash)}>
          <ClipboardCopy />
          {t('Copy hash')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(commit.subject)}>
          <ClipboardCopy />
          {t('Copy message')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void checkout(commit.hash)}>
          <GitBranch />
          {t('Check out this commit')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void createBranch(commit.hash)}>
          <GitBranchPlus />
          {t('New branch here…')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void pick('cherry-pick', commit)}>
          <CopyPlus />
          {t('Cherry-pick')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void pick('revert', commit)}>
          <Undo2 />
          {t('Revert')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function HistoryPanel() {
  const commits = useGit((s) => s.commits)
  const loaded = useGit((s) => s.logLoaded)
  const end = useGit((s) => s.logEnd)
  const all = useGit((s) => s.logAll)
  const view = useGit((s) => s.view)
  const git = useGit.getState()

  useEffect(() => {
    void useGit.getState().loadLog()
  }, [])
  const rows = useMemo(() => graphRows(commits), [commits])
  const width = useMemo(() => Math.min(8, Math.max(1, ...rows.map((r) => r.width))), [rows])
  const selected = view?.kind === 'commit' ? view.commit.hash : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <label className="flex flex-1 items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" checked={all} onChange={(e) => git.setLogAll(e.target.checked)} className="accent-primary" />
          {t('All branches')}
        </label>
        <IconButton icon={RefreshCw} label={t('Refresh')} onClick={() => void git.loadLog()} />
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {!loaded ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="w-48" />
            <Skeleton className="w-40" />
          </div>
        ) : commits.length === 0 ? (
          <p className="flex items-center gap-1.5 p-3 text-xs text-muted-foreground">
            <GitCommitHorizontal className="size-3.5" />
            {t('No commits yet.')}
          </p>
        ) : (
          <>
            {commits.map((c, i) => (
              <CommitRow key={c.hash} commit={c} row={rows[i] as GraphRow} width={width} selected={selected === c.hash} />
            ))}
            {!end && (
              <div className="p-2">
                <Button size="xs" variant="ghost" className="w-full" onClick={() => void git.loadLog(true)}>
                  {t('Load more')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
