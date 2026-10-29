import type { Profile } from '@shared/profiles'
import { cn } from '@/lib/utils'

/** A profile's color and label, shown wherever an account is at work. */
export function ProfileDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ backgroundColor: color }} />
}

export function ProfileBadge({ profile, className }: { profile: Pick<Profile, 'name' | 'label' | 'color'>; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <ProfileDot color={profile.color} />
      <span className="truncate">{profile.name}</span>
      {profile.label && (
        <span
          className="shrink-0 rounded px-1 text-[10px] leading-4 font-semibold tracking-wide uppercase"
          style={{ color: profile.color, backgroundColor: `color-mix(in oklab, ${profile.color} 14%, transparent)` }}
        >
          {profile.label}
        </span>
      )}
    </span>
  )
}
