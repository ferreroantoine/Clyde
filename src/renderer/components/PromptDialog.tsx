import { useState } from 'react'
import { create } from 'zustand'
import { t } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface Request {
  title: string
  label?: string
  initial?: string
  placeholder?: string
  confirm?: string
  /** An empty answer is allowed (and is not a cancel). */
  optional?: boolean
  /** An error to show under the field, or null when the value is fine. */
  validate?: (value: string) => string | null
  resolve: (value: string | null) => void
  id: number
}

let nextId = 0

const usePrompt = create<{ request: Request | null }>(() => ({ request: null }))

/** Asks for one line of text (Electron has no window.prompt). Null when cancelled. */
export function askText(options: Omit<Request, 'resolve' | 'id'>): Promise<string | null> {
  return new Promise((resolve) => {
    usePrompt.getState().request?.resolve(null)
    usePrompt.setState({ request: { ...options, resolve, id: ++nextId } })
  })
}

const close = (result: string | null) => {
  usePrompt.getState().request?.resolve(result)
  usePrompt.setState({ request: null })
}

/** Mounted once; shows the question askText() asks. */
export function PromptDialog() {
  const request = usePrompt((s) => s.request)
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
        </DialogHeader>
        {request && <Form key={request.id} request={request} />}
      </DialogContent>
    </Dialog>
  )
}

function Form({ request }: { request: Request }) {
  const [value, setValue] = useState(request.initial ?? '')
  const trimmed = value.trim()
  const error = trimmed && request.validate ? request.validate(trimmed) : null
  const allowed = (trimmed || request.optional) && !error
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (allowed) close(trimmed)
      }}
      className="flex flex-col gap-3"
    >
      <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={request.placeholder} aria-label={request.label ?? request.title} spellCheck={false} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => close(null)}>
          {t('Cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!allowed}>
          {request.confirm ?? t('OK')}
        </Button>
      </DialogFooter>
    </form>
  )
}
