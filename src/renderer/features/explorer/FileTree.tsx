import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  Bot,
  ChevronRight,
  ClipboardCopy,
  Copy,
  FilePlus,
  FolderOpen,
  FolderPlus,
  ListTodo,
  MessageSquareText,
  Pencil,
  SquareTerminal,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { t } from '@shared/i18n'
import type { DirEntry } from '@shared/types'
import { parentOf, useExplorer } from '@/stores/explorer'
import { useEditor } from '@/stores/editor'
import { useGit } from '@/stores/git'
import { STATE_COLOR, STATE_LABEL, STATE_LETTER } from '@/features/git/actions'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/Skeleton'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  absolutePath,
  addToAgent,
  askAgentToExplain,
  commitTreeEdit,
  copyText,
  duplicateEntry,
  newTaskFor,
  openTerminalAt,
  revealInOs,
  trashEntry
} from './actions'

/** Drag data type of a workspace-relative file path dragged from the Explorer. */
export const EXPLORER_PATH_TYPE = 'application/x-clyde-path'
import { FileIcon } from './FileIcon'

const INDENT = 12

/** A closing menu would take the focus back from the name field an item just opened. */
const keepFocus = (e: Event) => e.preventDefault()

function Item({ icon: Icon, label, shortcut, onSelect, destructive }: { icon: LucideIcon; label: string; shortcut?: string; onSelect: () => void; destructive?: boolean }) {
  return (
    <ContextMenuItem onSelect={onSelect} variant={destructive ? 'destructive' : 'default'} className="text-[13px]">
      <Icon />
      {label}
      {shortcut && <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>}
    </ContextMenuItem>
  )
}

/** New file and New folder, inside `dir` ('' is the root). */
function CreateItems({ dir }: { dir: string }) {
  const setEditing = useExplorer((s) => s.setEditing)
  return (
    <>
      <Item icon={FilePlus} label={t('New file…')} onSelect={() => setEditing({ mode: 'file', parent: dir })} />
      <Item icon={FolderPlus} label={t('New folder…')} onSelect={() => setEditing({ mode: 'dir', parent: dir })} />
    </>
  )
}

function EntryMenu({ entry }: { entry: DirEntry }) {
  const openFile = useEditor((s) => s.open)
  const setEditing = useExplorer((s) => s.setEditing)
  const isDir = entry.kind === 'dir'
  return (
    <ContextMenuContent className="w-64" onCloseAutoFocus={keepFocus}>
      {!isDir && (
        <>
          <Item icon={FolderOpen} label={t('Open')} onSelect={() => void openFile(entry.path)} />
          <ContextMenuSeparator />
        </>
      )}
      <Item icon={Bot} label={t('Add to agent session')} onSelect={() => addToAgent(entry.path)} />
      <Item icon={MessageSquareText} label={isDir ? t('Explain this folder') : t('Explain this file')} onSelect={() => askAgentToExplain(entry)} />
      {!isDir && <Item icon={Pencil} label={t('Edit this file with the agent…')} onSelect={() => addToAgent(entry.path)} />}
      <Item icon={ListTodo} label={t('Create an agent task…')} onSelect={() => newTaskFor(entry.path)} />
      <ContextMenuSeparator />
      <CreateItems dir={isDir ? entry.path : parentOf(entry.path)} />
      <Item icon={Pencil} label={t('Rename…')} shortcut="F2" onSelect={() => setEditing({ mode: 'rename', path: entry.path })} />
      <Item icon={Copy} label={t('Duplicate')} onSelect={() => void duplicateEntry(entry)} />
      <Item icon={Trash2} label={t('Delete')} shortcut={t('Del')} destructive onSelect={() => void trashEntry(entry.path, entry.kind)} />
      <ContextMenuSeparator />
      <Item icon={ClipboardCopy} label={t('Copy path')} onSelect={() => copyText(absolutePath(entry.path))} />
      <Item icon={ClipboardCopy} label={t('Copy relative path')} onSelect={() => copyText(entry.path)} />
      <Item icon={FolderOpen} label={t('Show in File Explorer')} onSelect={() => revealInOs(entry.path)} />
      <Item icon={SquareTerminal} label={t('Open in terminal')} onSelect={() => openTerminalAt(entry)} />
    </ContextMenuContent>
  )
}

/** The name field of a rename or a new entry; Enter saves, Escape or leaving the field cancels. */
function NameInput({ initial, depth, kind }: { initial: string; depth: number; kind: DirEntry['kind'] }) {
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    // Select the name without its extension, as most editors do.
    const dot = kind === 'file' ? initial.lastIndexOf('.') : -1
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial, kind])

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save) void commitTreeEdit(value)
    else useExplorer.getState().setEditing(null)
  }

  return (
    <div style={{ paddingLeft: 8 + depth * INDENT }} className="flex h-6 items-center gap-1.5 pr-2">
      <ChevronRight className="invisible size-3.5 shrink-0" />
      <FileIcon name={value || initial} dir={kind === 'dir'} open={false} />
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') finish(true)
          if (e.key === 'Escape') finish(false)
        }}
        onBlur={() => finish(true)}
        aria-label={t('Name')}
        spellCheck={false}
        className="h-5 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-[13px] outline-none"
      />
    </div>
  )
}

function Row({ entry, depth }: { entry: DirEntry; depth: number }) {
  const expanded = useExplorer((s) => !!s.expanded[entry.path])
  const selected = useExplorer((s) => s.selected === entry.path)
  const renaming = useExplorer((s) => s.editing?.mode === 'rename' && s.editing.path === entry.path)
  const isActive = useEditor((s) => s.active === entry.path)
  const toggle = useExplorer((s) => s.toggle)
  const select = useExplorer((s) => s.select)
  const openFile = useEditor((s) => s.open)
  const isDir = entry.kind === 'dir'
  const state = useGit((s) => (isDir ? undefined : s.decorations[entry.path]))
  const dirty = useGit((s) => isDir && !!s.dirtyDirs[entry.path])
  const ignored = useGit((s) => !!s.ignored[entry.path])

  const onClick = () => {
    select(entry.path)
    if (isDir) toggle(entry.path)
    else void openFile(entry.path)
  }

  return (
    <>
      {renaming ? (
        <NameInput initial={entry.name} depth={depth} kind={entry.kind} />
      ) : (
        <ContextMenu onOpenChange={(open) => open && select(entry.path)}>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={onClick}
              // The tree's empty space has its own menu; a row's menu replaces it.
              onContextMenu={(e) => e.stopPropagation()}
              title={entry.path}
              data-path={entry.path}
              data-kind={entry.kind}
              // Files can be dropped on the chat composer as attachments.
              draggable={!isDir}
              onDragStart={(e) => {
                e.dataTransfer.setData(EXPLORER_PATH_TYPE, entry.path)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              style={{ paddingLeft: 8 + depth * INDENT }}
              className={cn(
                'press press-soft flex h-6 w-full items-center gap-1.5 pr-2 text-left text-[13px] outline-none',
                'hover:bg-accent/70 focus-visible:bg-accent data-[state=open]:bg-accent',
                selected && 'bg-accent',
                isActive && !selected && 'text-foreground',
                !isActive && !selected && 'text-foreground/85'
              )}
            >
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
                  !isDir && 'invisible',
                  expanded && 'rotate-90'
                )}
              />
              <FileIcon name={entry.name} dir={isDir} open={expanded} />
              <span className={cn('truncate', state && STATE_COLOR[state], ignored && 'opacity-50')}>{entry.name}</span>
              {state && (
                <span className={cn('ml-auto shrink-0 pl-1 font-mono text-[10px] font-semibold', STATE_COLOR[state])} title={t(STATE_LABEL[state])}>
                  {STATE_LETTER[state]}
                </span>
              )}
              {dirty && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-warning/80" aria-label={t('Contains changes')} />}
            </button>
          </ContextMenuTrigger>
          <EntryMenu entry={entry} />
        </ContextMenu>
      )}
      {isDir && expanded && <Children path={entry.path} depth={depth + 1} />}
    </>
  )
}

function Children({ path, depth }: { path: string; depth: number }) {
  const entries = useExplorer((s) => s.children[path])
  const creating = useExplorer((s) => (s.editing && s.editing.mode !== 'rename' && s.editing.parent === path ? s.editing.mode : null))
  const newEntry = creating && (
    <NameInput key={`new-${creating}`} initial="" depth={depth} kind={creating === 'dir' ? 'dir' : 'file'} />
  )
  if (!entries) {
    return (
      <div style={{ paddingLeft: 8 + depth * INDENT + 20 }} className="flex h-6 items-center pr-4">
        <Skeleton className="w-24" />
      </div>
    )
  }
  if (entries.length === 0 && depth > 0) {
    return (
      newEntry || (
        <div style={{ paddingLeft: 8 + depth * INDENT + 20 }} className="h-6 text-xs leading-6 text-muted-foreground italic">
          {t('Empty')}</div>
      )
    )
  }
  return (
    <>
      {newEntry}
      {entries.map((e) => (
        <Row key={e.path} entry={e} depth={depth} />
      ))}
    </>
  )
}

/** F2 renames the selected entry, Delete moves it to the Recycle Bin. */
function onTreeKey(e: KeyboardEvent<HTMLDivElement>) {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-path]')
  const path = row?.dataset.path
  if (!path) return
  if (e.key === 'F2') {
    e.preventDefault()
    useExplorer.getState().setEditing({ mode: 'rename', path })
  } else if (e.key === 'Delete') {
    e.preventDefault()
    void trashEntry(path, row.dataset.kind === 'dir' ? 'dir' : 'file')
  }
}

export function FileTree() {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div role="tree" className="flex-1 py-1" onKeyDown={onTreeKey}>
          <Children path="" depth={0} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={keepFocus}>
        <CreateItems dir="" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
