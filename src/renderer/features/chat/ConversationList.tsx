import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { DATE_GROUP_LABELS, dateGroup, type Conversation, type DateGroup } from '@shared/chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ProfileDot } from '@/components/ProfileBadge'
import { SkeletonLines } from '@/components/Skeleton'
import { useNow } from '@/features/limits/LimitGauge'
import { useChat } from '@/stores/chat'
import { profileById, useProfiles } from '@/stores/profiles'
import { enter, spring } from '@/lib/motion'
import { cn } from '@/lib/utils'

const ORDER: DateGroup[] = ['pinned', 'today', 'yesterday', 'week', 'month', 'older']

function Row({ conversation, active }: { conversation: Conversation; active: boolean }) {
  const select = useChat((s) => s.select)
  const update = useChat((s) => s.update)
  const remove = useChat((s) => s.remove)
  const profile = profileById(useProfiles((s) => s.profiles), conversation.profileId)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(conversation.title)

  if (renaming) {
    return (
      <form
        className="px-1 py-0.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) void update(conversation.id, { title: title.trim() })
          setRenaming(false)
        }}
      >
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
          aria-label={t('Conversation title')}
          className="h-7 text-[13px]"
        />
      </form>
    )
  }
  return (
    <motion.div layout="position" variants={enter} initial="hidden" animate="shown" exit="gone" transition={{ layout: spring.layout }} className="group relative">
      <button
        type="button"
        onClick={() => void select(conversation.id)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'press press-soft flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-7 text-left text-[13px]',
          active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
        )}
      >
        {profile && <ProfileDot color={profile.color} className="size-1.5" />}
        <span className="truncate">{conversation.title || t('New conversation')}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('Actions for {name}', { name: conversation.title })}
            className="press absolute top-1/2 right-1 hidden -translate-y-1/2 rounded p-0.5 text-muted-foreground group-hover:block hover:bg-background hover:text-foreground focus-visible:block data-[state=open]:block"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setTitle(conversation.title)
              setRenaming(true)
            }}
          >
            <Pencil /> {t('Rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void update(conversation.id, { pinned: !conversation.pinned })}>
            {conversation.pinned ? <PinOff /> : <Pin />} {conversation.pinned ? t('Unpin') : t('Pin')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void remove(conversation.id)}>
            <Trash2 /> {t('Delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.div>
  )
}

/** New conversation, search, and the conversations grouped by date. */
export function ConversationList() {
  const conversations = useChat((s) => s.conversations)
  const loaded = useChat((s) => s.loaded)
  const activeId = useChat((s) => s.activeId)
  const select = useChat((s) => s.select)
  const query = useChat((s) => s.query)
  const matches = useChat((s) => s.matches)
  const search = useChat((s) => s.search)
  const now = useNow(60_000)

  const groups = useMemo(() => {
    const shown = matches ? conversations.filter((c) => matches.includes(c.id)) : conversations
    const out = new Map<DateGroup, Conversation[]>()
    for (const c of shown) {
      const g = dateGroup(c, now)
      out.set(g, [...(out.get(g) ?? []), c])
    }
    return ORDER.filter((g) => out.has(g)).map((g) => ({ group: g, items: out.get(g) as Conversation[] }))
  }, [conversations, matches, now])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-chrome" aria-label={t('Conversations')}>
      <div className="space-y-2 p-3">
        <Button className="w-full justify-start" size="sm" variant="outline" onClick={() => void select(null)}>
          <Plus /> {t('New conversation')}
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => void search(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && void search('')}
            placeholder={t('Search conversations')}
            aria-label={t('Search conversations')}
            className="h-8 pr-7 pl-7 text-xs"
          />
          {query && (
            <button
              type="button"
              aria-label={t('Clear the search')}
              onClick={() => void search('')}
              className="press absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        {!loaded && <SkeletonLines count={5} className="px-2" />}
        {loaded && groups.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{query ? t('No conversation matches.') : t('No conversation yet.')}</p>
        )}
        {groups.map(({ group, items }) => (
          <section key={group}>
            <h3 className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{t(DATE_GROUP_LABELS[group])}</h3>
            <AnimatePresence initial={false}>
              {items.map((c) => (
                <Row key={c.id} conversation={c} active={c.id === activeId} />
              ))}
            </AnimatePresence>
          </section>
        ))}
      </nav>
    </aside>
  )
}
