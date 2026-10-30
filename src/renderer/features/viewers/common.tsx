import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, FileQuestion, FolderOpen, LoaderCircle } from 'lucide-react'
import { t } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { invoke } from '@/lib/ipc'
import { getModel } from '@/lib/monaco/models'
import { fileUrl } from '@/lib/viewers'
import { notify } from '@/stores/notifications'
import type { EditorTab } from '@/stores/editor'

/** The text of an open tab, following the edits made in the code view. Mount it per path (a `key`). */
export function useModelText(path: string): string {
  const [text, setText] = useState(() => getModel(path)?.getValue() ?? '')
  useEffect(() => {
    const model = getModel(path)
    if (!model) return
    let timer: ReturnType<typeof setTimeout> | undefined
    // Typing in the code view refreshes the preview a moment later, not on every key.
    const sub = model.onDidChangeContent(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setText(model.getValue()), 150)
    })
    return () => {
      clearTimeout(timer)
      sub.dispose()
    }
  }, [path])
  return text
}

export type Loaded<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T }

/**
 * The file's bytes from clyde-file://, read again when it changes on disk. `maxBytes` reads
 * only the start (a range request).
 */
export function useFileBytes(tab: EditorTab, maxBytes?: number): Loaded<ArrayBuffer> {
  const [loaded, setLoaded] = useState<{ key: string; value: Loaded<ArrayBuffer> } | null>(null)
  const key = `${tab.path}@${tab.mtimeMs ?? 0}`
  useEffect(() => {
    let alive = true
    const headers: Record<string, string> = maxBytes ? { range: `bytes=0-${maxBytes - 1}` } : {}
    fetch(fileUrl(tab.path, tab.mtimeMs), { headers })
      .then((r) => {
        if (!r.ok) throw new Error(t('The file could not be read ({status}).', { status: r.status }))
        return r.arrayBuffer()
      })
      .then(
        (value) => alive && setLoaded({ key, value: { state: 'ready', value } }),
        (err: unknown) => alive && setLoaded({ key, value: { state: 'error', message: err instanceof Error ? err.message : String(err) } })
      )
    return () => {
      alive = false
    }
  }, [key, tab.path, tab.mtimeMs, maxBytes])
  return loaded?.key === key ? loaded.value : { state: 'loading' }
}

export function Spinner() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" />
    </div>
  )
}

/** Opens the file in the app Windows associates with it, or shows it in the Explorer. */
export function ExternalActions({ path }: { path: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => void invoke('fs:openDefault', { path }).catch((err) => notify.error(t('Could not open the file'), err))}
      >
        <ExternalLink /> {t('Open with the default app')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void invoke('fs:reveal', { path })}>
        <FolderOpen /> {t('Show in File Explorer')}
      </Button>
    </div>
  )
}

/** For a file no viewer can show, or one its viewer failed on. */
export function CannotShow({ path, title, description }: { path: string; title?: string; description?: ReactNode }) {
  return (
    <EmptyState
      icon={FileQuestion}
      title={title ?? t('This file cannot be shown')}
      description={description ?? t('Clyde has no viewer for this kind of file.')}
      action={<ExternalActions path={path} />}
    />
  )
}
