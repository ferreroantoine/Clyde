import { CircleAlert, Code2, FileWarning, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { useEditor } from '@/stores/editor'
import { useWorkspace } from '@/stores/workspace'
import { MonacoHost } from './MonacoHost'
import { TabBar } from './TabBar'

const SHORTCUTS: Array<[string, string]> = [
  ['Toggle sidebar', 'Ctrl+B'],
  ['Search in files', 'Ctrl+Shift+F'],
  ['Toggle terminal', 'Ctrl+J'],
  ['Toggle agent panel', 'Ctrl+Alt+B'],
  ['Save file', 'Ctrl+S'],
  ['Settings', 'Ctrl+,']
]

function Welcome() {
  const info = useWorkspace((s) => s.info)
  const pick = useWorkspace((s) => s.pick)
  return (
    <EmptyState
      icon={Code2}
      title={info ? 'No file open' : 'Welcome to Clyde'}
      description={info ? 'Pick a file in the explorer to open it here.' : 'Open a folder to get started.'}
      action={
        <div className="flex flex-col items-center gap-4">
          {!info && (
            <Button size="sm" onClick={() => void pick()}>
              Open folder
            </Button>
          )}
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1.5 text-xs">
            {SHORTCUTS.map(([label, keys]) => (
              <div key={label} className="contents">
                <dt className="text-right text-muted-foreground">{label}</dt>
                <dd>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      }
    />
  )
}

function ConflictBanner({ path, kind }: { path: string; kind: 'modified' | 'deleted' }) {
  const reload = useEditor((s) => s.reloadFromDisk)
  const save = useEditor((s) => s.save)
  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-warning/15 px-3 py-1.5 text-xs">
      <CircleAlert className="size-3.5 text-warning" />
      <span className="flex-1">
        {kind === 'deleted'
          ? 'This file was deleted on disk. Saving will recreate it.'
          : 'This file changed on disk while you were editing it.'}
      </span>
      {kind === 'modified' && (
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => void reload(path)}>
          Load disk version
        </Button>
      )}
      <Button size="sm" className="h-6 text-xs" onClick={() => void save(path)}>
        Keep mine and save
      </Button>
    </div>
  )
}

export function EditorArea() {
  const tabs = useEditor((s) => s.tabs)
  const active = useEditor((s) => s.active)
  const tab = tabs.find((t) => t.path === active) ?? null
  const ready = tab?.status === 'ready'

  return (
    <div className="flex h-full flex-col bg-editor">
      {tabs.length > 0 && <TabBar />}
      {tab?.conflict && <ConflictBanner path={tab.path} kind={tab.conflict} />}
      <div className="relative min-h-0 flex-1">
        <div className={ready ? 'h-full' : 'invisible h-full'}>
          <MonacoHost path={tab?.path ?? null} ready={ready} />
        </div>
        {!tab && (
          <div className="absolute inset-0">
            <Welcome />
          </div>
        )}
        {tab && !ready && (
          <div className="absolute inset-0 bg-editor">
            {tab.status === 'loading' && (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            )}
            {tab.status === 'unsupported' && (
              <EmptyState
                icon={FileWarning}
                title={tab.unsupported === 'binary' ? 'Binary file' : 'File too large'}
                description={
                  tab.unsupported === 'binary'
                    ? 'This file is not text, so it cannot be shown in the editor.'
                    : 'Files over 5 MB are not opened in the editor.'
                }
              />
            )}
            {tab.status === 'error' && (
              <EmptyState icon={CircleAlert} title="Could not open file" description={tab.error} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
