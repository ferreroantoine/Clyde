import { Separator } from 'react-resizable-panels'
import { cn } from '@/lib/utils'

/** Thin 1px divider with a wider invisible hit area and an accent line while dragging. */
export function ResizeHandle({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  const vertical = orientation === 'vertical'
  return (
    <Separator
      className={cn(
        'relative shrink-0 bg-border outline-none transition-colors',
        'after:absolute after:content-[""] data-[separator=hover]:bg-primary/40 data-[separator=active]:bg-primary',
        vertical ? 'h-px after:inset-x-0 after:-inset-y-1' : 'w-px after:inset-y-0 after:-inset-x-1'
      )}
    />
  )
}
