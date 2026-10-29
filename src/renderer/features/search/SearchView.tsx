import { CaseSensitive, LoaderCircle, Regex, Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { IconButton } from '@/components/IconButton'
import { useSearch, type FileMatches } from '@/stores/search'
import { useEditor } from '@/stores/editor'
import { FileIcon } from '@/features/explorer/FileIcon'
import { cn } from '@/lib/utils'

function Highlight({ preview, start, length }: { preview: string; start: number; length: number }) {
  const before = preview.slice(0, start)
  const hit = preview.slice(start, start + length)
  const after = preview.slice(start + length)
  return (
    <span className="truncate font-mono text-[12px]">
      {before}
      <mark className="rounded-sm bg-warning/35 text-foreground">{hit}</mark>
      {after}
    </span>
  )
}

function FileGroup({ group }: { group: FileMatches }) {
  const open = useEditor((s) => s.open)
  const name = group.path.split('/').pop() ?? group.path
  const dir = group.path.slice(0, -name.length - 1)
  return (
    <div className="mb-1">
      <div className="flex h-6 items-center gap-1.5 px-3 text-[13px]" title={group.path}>
        <FileIcon name={name} />
        <span className="truncate">{name}</span>
        <span className="truncate text-[11px] text-muted-foreground">{dir}</span>
        <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
          {group.matches.length}
        </span>
      </div>
      {group.matches.map((m) => (
        <button
          key={`${m.line}:${m.column}`}
          type="button"
          onClick={() => void open(m.path, { line: m.line, column: m.column, length: m.matchLength })}
          className="flex h-6 w-full items-center gap-2 pr-3 pl-9 text-left text-muted-foreground hover:bg-accent/70 hover:text-foreground"
        >
          <span className="w-7 shrink-0 text-right text-[10px] tabular-nums opacity-60">{m.line}</span>
          <Highlight preview={m.preview} start={m.previewStart} length={m.matchLength} />
        </button>
      ))}
    </div>
  )
}

export function SearchView() {
  const s = useSearch()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <div className="flex items-center gap-1 rounded-md border bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            value={s.query}
            onChange={(e) => s.setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && s.clear()}
            placeholder="Search in files"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
          {s.query && <IconButton icon={X} label="Clear" onClick={s.clear} />}
          <IconButton icon={CaseSensitive} label="Match case" active={s.caseSensitive} onClick={s.toggleCase} />
          <IconButton icon={Regex} label="Use regular expression" active={s.regex} onClick={s.toggleRegex} />
        </div>
        <div className="mt-1.5 flex h-4 items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          {s.running && <LoaderCircle className="size-3 animate-spin" />}
          {s.error ? (
            <span className="text-destructive">{s.error}</span>
          ) : (
            s.query &&
            !s.running && (
              <span>
                {s.total} result{s.total === 1 ? '' : 's'} in {s.results.length} file{s.results.length === 1 ? '' : 's'}
                {s.truncated && ' (limit reached)'}
              </span>
            )
          )}
        </div>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto pb-2', s.running && 'opacity-60')}>
        {s.results.map((g) => (
          <FileGroup key={g.path} group={g} />
        ))}
      </div>
    </div>
  )
}
