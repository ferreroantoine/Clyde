import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'

/** A shimmering placeholder block while something loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-3', className)} />
}

/** Placeholder cards, e.g. for a list of accounts or servers that has not arrived yet. */
export function SkeletonCards({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label={t('Loading…')} className={cn('space-y-3', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2.5 rounded-xl border bg-card p-4">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="w-2/3" />
          <Skeleton className="w-1/2" />
        </div>
      ))}
    </div>
  )
}

/** Placeholder lines, e.g. for a file tree or a diff. */
export function SkeletonLines({ count = 6, className }: { count?: number; className?: string }) {
  const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-2/5', 'w-3/5']
  return (
    <div role="status" aria-label={t('Loading…')} className={cn('space-y-2', className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={widths[i % widths.length]} />
      ))}
    </div>
  )
}
