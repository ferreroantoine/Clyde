import { useMemo, useState } from 'react'
import { ChevronRight, Code2, TriangleAlert } from 'lucide-react'
import { t, tn } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { extensionOf } from '@/lib/viewers'
import { cn } from '@/lib/utils'
import { useEditor, type EditorTab } from '@/stores/editor'
import { useModelText } from './common'

const PAGE = 100

type Parsed = { ok: true; value: unknown } | { ok: false; message: string }

/** JSON, or JSON Lines (one value per line, shown as a list). */
export function parseJson(text: string, jsonLines: boolean): Parsed {
  try {
    if (!jsonLines) return { ok: true, value: JSON.parse(text) }
    const lines = text.split(/\r?\n/)
    const values: unknown[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim()
      if (!line) continue
      try {
        values.push(JSON.parse(line))
      } catch (err) {
        return { ok: false, message: t('Line {line}: {message}', { line: i + 1, message: (err as Error).message }) }
      }
    }
    return { ok: true, value: values }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted-foreground">null</span>
  if (typeof value === 'string') return <span className="break-all text-success">"{value}"</span>
  if (typeof value === 'number') return <span className="text-primary">{String(value)}</span>
  return <span className="text-warning">{String(value)}</span>
}

function Node({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  const branch = value !== null && typeof value === 'object'
  const [open, setOpen] = useState(depth < 2)
  const [shown, setShown] = useState(PAGE)
  const entries = useMemo(() => (branch ? (Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as object)) : []), [branch, value])
  const label = name !== null && <span className="text-foreground/80">{name}: </span>
  if (!branch) {
    return (
      <div className="pl-4">
        {label}
        <Scalar value={value} />
      </div>
    )
  }
  const isArray = Array.isArray(value)
  return (
    <div>
      <button type="button" className="press flex items-center gap-0.5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        {label}
        <span className="text-muted-foreground">
          {isArray ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </button>
      {open && (
        <div className="ml-1.5 border-l border-border/60 pl-1.5">
          {entries.slice(0, shown).map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} />
          ))}
          {entries.length > shown && (
            <button type="button" className="press pl-4 text-primary hover:underline" onClick={() => setShown(shown + PAGE * 10)}>
              {tn('Show {count} more', 'Show {count} more', Math.min(entries.length - shown, PAGE * 10))}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** A JSON file as a tree that folds; a parse error points to the code view. */
export default function JsonView({ tab }: { tab: EditorTab }) {
  const text = useModelText(tab.path)
  const lines = extensionOf(tab.path) === 'jsonl'
  const parsed = useMemo(() => parseJson(text, lines), [text, lines])
  return (
    <div className="selectable h-full overflow-auto bg-editor px-4 py-3 font-mono text-[12.5px] leading-relaxed" data-testid="json-view">
      {parsed.ok ? (
        <Node name={null} value={parsed.value} depth={0} />
      ) : (
        <div className="flex flex-col items-start gap-2 font-sans text-xs">
          <p className="flex items-start gap-1.5 text-destructive">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            {t('This is not valid JSON: {message}', { message: parsed.message })}
          </p>
          <Button size="xs" variant="outline" onClick={() => useEditor.getState().setMode(tab.path, 'code')}>
            <Code2 /> {t('Show the code')}
          </Button>
        </div>
      )}
    </div>
  )
}
