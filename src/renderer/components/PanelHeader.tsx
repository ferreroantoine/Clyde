import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PanelHeader({ title, actions, className }: { title: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3', className)}>
      <span className="truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </span>
      {actions && <div className="flex items-center gap-0.5">{actions}</div>}
    </div>
  )
}
