import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { useNotifications, type NoticeLevel } from '@/stores/notifications'
import { cn } from '@/lib/utils'

const ICONS: Record<NoticeLevel, typeof Info> = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert }

export function Toaster() {
  const notices = useNotifications((s) => s.notices)
  const dismiss = useNotifications((s) => s.dismiss)

  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-50 flex w-80 flex-col gap-2">
      {notices.map((n) => {
        const Icon = ICONS[n.level]
        return (
          <div
            key={n.id}
            role={n.level === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-2"
          >
            <Icon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                n.level === 'error' && 'text-destructive',
                n.level === 'success' && 'text-success',
                n.level === 'warning' && 'text-warning',
                n.level === 'info' && 'text-primary'
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{n.title}</p>
              {n.detail && <p className="mt-0.5 text-xs break-words text-muted-foreground">{n.detail}</p>}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(n.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
