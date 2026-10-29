import { useState, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { t } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { cn } from '@/lib/utils'

export function Row({ label, hint, children, id }: { label: string; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b py-3.5 last:border-b-0" data-setting={id}>
      <div className="min-w-0 flex-1 basis-56 space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'press relative h-5 w-9 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
        checked ? 'bg-primary' : 'bg-input'
      )}
    >
      <span
        className={cn('absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow-sm transition-transform', checked && 'translate-x-4')}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="flex rounded-lg border bg-muted p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'press rounded-md px-3 py-1 text-xs transition-colors',
            value === o.value ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  className
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        'h-8 rounded-md border border-input bg-background px-2 text-xs shadow-xs focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        className
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** A number saved when valid, as you type. */
export function NumberField({
  value,
  min,
  max,
  onChange,
  label,
  suffix
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  label: string
  suffix?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const [prev, setPrev] = useState(value)
  // A reset elsewhere replaces what was typed.
  if (prev !== value) {
    setPrev(value)
    setDraft(String(value))
  }
  return (
    <span className="flex items-center gap-1.5">
      <Input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        className="h-8 w-20 text-right tabular-nums"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n >= min && n <= max) onChange(n)
        }}
        onBlur={() => setDraft(String(value))}
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </span>
  )
}

/** Text saved on blur or Enter. */
export function TextField({
  value,
  onChange,
  label,
  placeholder,
  mono = true,
  className
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  mono?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setDraft(value)
  }
  const commit = () => {
    if (draft.trim() !== value) onChange(draft.trim())
  }
  return (
    <Input
      aria-label={label}
      className={cn('h-8 w-64', mono && 'font-mono text-xs', className)}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      spellCheck={false}
    />
  )
}

/** A path typed or picked with the system dialog. */
export function PathField({
  value,
  onChange,
  label,
  placeholder,
  kind = 'folder'
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  kind?: 'folder' | 'file'
}) {
  return (
    <span className="flex items-center gap-1.5">
      <TextField value={value} onChange={onChange} label={label} {...(placeholder ? { placeholder } : {})} className="w-56" />
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={t('Browse…')}
        onClick={() => {
          void invoke('app:pickPath', { kind, title: label, ...(value ? { defaultPath: value } : {}) }).then((p) => p && onChange(p))
        }}
      >
        <FolderOpen />
      </Button>
    </span>
  )
}
