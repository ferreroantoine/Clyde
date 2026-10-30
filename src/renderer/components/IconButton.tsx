import type { LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: LucideIcon
  label: string
  shortcut?: string
  active?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  size?: 'sm' | 'md'
}

export function IconButton({
  icon: Icon,
  label,
  shortcut,
  active,
  side = 'bottom',
  size = 'sm',
  className,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'press inline-flex items-center justify-center rounded-md text-muted-foreground',
            'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-40',
            size === 'sm' ? 'size-6 [&_svg]:size-3.5' : 'size-9 [&_svg]:size-[18px]',
            active && 'bg-accent text-foreground',
            className
          )}
          {...props}
        >
          <Icon strokeWidth={1.7} />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {shortcut && <span className="ml-2 text-[10px] opacity-60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}
