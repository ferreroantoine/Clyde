import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, File, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { FileIcon } from '@/features/explorer/FileIcon'
import { invoke } from '@/lib/ipc'
import { fuzzyFilter, fuzzyScore } from '@/lib/fuzzy'
import { cn } from '@/lib/utils'
import { useEditor } from '@/stores/editor'
import { useLayout } from '@/stores/layout'
import { usePalette } from '@/stores/palette'
import { useWorkspace } from '@/stores/workspace'
import { buildCommands, type Command } from './commands'

type Entry = { kind: 'command'; command: Command } | { kind: 'file'; path: string }

function Highlight({ text, query }: { text: string; query: string }) {
  const positions = new Set(fuzzyScore(query, text)?.positions ?? [])
  if (!query || positions.size === 0) return <>{text}</>
  return (
    <>
      {[...text].map((ch, i) =>
        positions.has(i) ? (
          <mark key={i} className="bg-transparent font-semibold text-primary">
            {ch}
          </mark>
        ) : (
          ch
        )
      )}
    </>
  )
}

/** Ctrl+K: every action and, below them, the workspace files. Ctrl+P opens it on files only. */
export function CommandPalette() {
  const open = usePalette((s) => s.open)
  const mode = usePalette((s) => s.mode)
  const hide = usePalette((s) => s.hide)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && hide()}>
      <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Type to filter commands and files, Enter to run.</DialogDescription>
        {open && <PaletteBody key={mode} mode={mode} close={hide} />}
      </DialogContent>
    </Dialog>
  )
}

function PaletteBody({ mode, close }: { mode: 'all' | 'files'; close: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const root = useWorkspace((s) => s.info?.root)
  const commands = useMemo(() => (mode === 'all' ? buildCommands() : []), [mode])
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!root) return
    let alive = true
    invoke('files:list')
      .then((r) => alive && setFiles(r.files))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [root])

  const entries = useMemo<Entry[]>(() => {
    const cmds = fuzzyFilter(commands, query, (c) => c.title, 40).map((command): Entry => ({ kind: 'command', command }))
    // Files show once the user types (or in files mode), so the command list stays short.
    const showFiles = mode === 'files' || query.trim().length > 0
    const fileEntries = showFiles ? fuzzyFilter(files, query, (p) => p, 30).map((path): Entry => ({ kind: 'file', path })) : []
    return [...cmds, ...fileEntries]
  }, [commands, files, query, mode])
  const current = Math.min(index, Math.max(0, entries.length - 1))

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const run = (entry: Entry | undefined) => {
    if (!entry) return
    close()
    if (entry.kind === 'command') entry.command.run()
    else {
      useLayout.getState().showCenter('editor')
      void useEditor.getState().open(entry.path)
    }
  }

  let lastGroup = ''
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setIndex((current + 1) % Math.max(1, entries.length))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setIndex((current - 1 + entries.length) % Math.max(1, entries.length))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          run(entries[current])
        }
      }}
    >
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          placeholder={mode === 'files' ? 'Go to file…' : 'Type a command or a file name…'}
          aria-label="Command"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={entries.length ? `palette-${current}` : undefined}
          className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div ref={list} id="palette-list" role="listbox" className="max-h-80 overflow-y-auto p-1.5">
        {entries.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {mode === 'files' && !root ? 'Open a folder to search its files.' : 'Nothing matches.'}
          </p>
        )}
        {entries.map((entry, i) => {
          const group = entry.kind === 'command' ? entry.command.group : 'Files'
          const header = group !== lastGroup ? group : null
          lastGroup = group
          return (
            <div key={entry.kind === 'command' ? entry.command.id : `file:${entry.path}`}>
              {header && <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{header}</p>}
              <div
                id={`palette-${i}`}
                role="option"
                aria-selected={i === current}
                data-index={i}
                onMouseMove={() => i !== current && setIndex(i)}
                onClick={() => run(entry)}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
                  i === current && 'bg-accent text-accent-foreground'
                )}
              >
                {entry.kind === 'command' ? (
                  <>
                    <span className="min-w-0 flex-1 truncate">
                      <Highlight text={entry.command.title} query={query} />
                    </span>
                    {entry.command.shortcut && (
                      <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">{entry.command.shortcut}</kbd>
                    )}
                  </>
                ) : (
                  <>
                    <FileIcon name={entry.path.split('/').pop() ?? entry.path} dir={false} open={false} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      <Highlight text={entry.path} query={query} />
                    </span>
                  </>
                )}
                {i === current && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
              </div>
            </div>
          )
        })}
      </div>
      <p className="flex items-center gap-1 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <File className="size-3" /> ↑↓ to move · Enter to run · Esc to close
      </p>
    </div>
  )
}
