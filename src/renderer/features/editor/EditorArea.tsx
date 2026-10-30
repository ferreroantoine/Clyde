import { CircleAlert, Code2, FileWarning, LoaderCircle } from 'lucide-react'
import { t } from '@shared/i18n'
import { effectiveBindings, formatCombo, KEY_COMMANDS } from '@shared/keybindings'
import { useSettings } from '@/stores/settings'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { useEditor } from '@/stores/editor'
import { useWorkspace } from '@/stores/workspace'
import { MonacoHost } from './MonacoHost'
import { TabBar } from './TabBar'
import { useGit } from '@/stores/git'
import { GitDiffPane } from '@/features/git/GitDiffPane'

/** Shortcuts shown on the welcome screen, with the keys currently bound to them. */
const WELCOME_COMMANDS = ['layout.sidebar', 'view.search', 'layout.terminal', 'layout.agentPanel', 'file.save', 'view.settings']

function Welcome() {
  const info = useWorkspace((s) => s.info)
  const pick = useWorkspace((s) => s.pick)
  const bindings = effectiveBindings(useSettings((s) => s.settings.shortcuts.bindings))
  const shortcuts = WELCOME_COMMANDS.flatMap((id) => {
    const spec = KEY_COMMANDS.find((c) => c.id === id)
    const combo = bindings[id]
    return spec && combo ? [[t(spec.label), formatCombo(combo)] as const] : []
  })
  return (
    <EmptyState
      icon={Code2}
      title={info ? t('No file open') : t('Welcome to Clyde')}
      description={info ? t('Pick a file in the explorer to open it here.') : t('Open a folder to get started.')}
      action={
        <div className="flex flex-col items-center gap-4">
          {!info && (
            <Button size="sm" onClick={() => void pick()}>
              {t('Open folder')}</Button>
          )}
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1.5 text-xs">
            {shortcuts.map(([label, keys]) => (
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
          ? t('This file was deleted on disk. Saving will recreate it.')
          : t('This file changed on disk while you were editing it.')}
      </span>
      {kind === 'modified' && (
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => void reload(path)}>
          {t('Load disk version')}</Button>
      )}
      <Button size="sm" className="h-6 text-xs" onClick={() => void save(path)}>
        {t('Keep mine and save')}</Button>
    </div>
  )
}

export function EditorArea() {
  const tabs = useEditor((s) => s.tabs)
  const active = useEditor((s) => s.active)
  const tab = tabs.find((t) => t.path === active) ?? null
  const ready = tab?.status === 'ready'
  const gitView = useGit((s) => s.view !== null)

  return (
    <div className="flex h-full flex-col bg-editor">
      {tabs.length > 0 && (
        // Picking a tab, even the active one, leaves the diff.
        <div onMouseDownCapture={() => gitView && useGit.getState().show(null)}>
          <TabBar />
        </div>
      )}
      {tab?.conflict && <ConflictBanner path={tab.path} kind={tab.conflict} />}
      <div className="relative min-h-0 flex-1">
        <div className={ready ? 'h-full' : 'invisible h-full'}>
          <MonacoHost path={tab?.path ?? null} ready={ready} />
        </div>
        {gitView && (
          <div className="absolute inset-0 z-10">
            <GitDiffPane />
          </div>
        )}
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
                title={tab.unsupported === 'binary' ? t('Binary file') : t('File too large')}
                description={
                  tab.unsupported === 'binary'
                    ? t('This file is not text, so it cannot be shown in the editor.')
                    : t('Files over 5 MB are not opened in the editor.')
                }
              />
            )}
            {tab.status === 'error' && (
              <EmptyState icon={CircleAlert} title={t('Could not open file')} description={tab.error} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
