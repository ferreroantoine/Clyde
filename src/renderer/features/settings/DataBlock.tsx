import { useEffect, useState } from 'react'
import { Download, FolderOpen, Trash2, Upload } from 'lucide-react'
import type { DataPaths } from '@shared/config-export'
import { t } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { invoke } from '@/lib/ipc'
import { notify } from '@/stores/notifications'
import { useSettings } from '@/stores/settings'
import { Row } from './controls'

export function DataBlock() {
  const [paths, setPaths] = useState<DataPaths | null>(null)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    void invoke('data:paths').then(setPaths)
  }, [])

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try {
      await fn()
    } catch (err) {
      notify.error(t('That did not work'), err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <Row label={t('Database')} hint={paths?.database}>
        <Button size="sm" variant="outline" onClick={() => void invoke('data:open', { target: 'database' })}>
          <FolderOpen /> {t('Show')}
        </Button>
      </Row>
      <Row label={t('Logs')} hint={paths?.logs}>
        <Button size="sm" variant="outline" onClick={() => void invoke('data:open', { target: 'logs' })}>
          <FolderOpen /> {t('Open')}
        </Button>
      </Row>
      <Row
        label={t('Export configuration')}
        hint={t('Settings, accounts, MCP servers, saved agents and your prices, in a JSON file. No API key, token or MCP secret is written.')}
      >
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            void run('export', async () => {
              const result = await invoke('data:export')
              if (result) notify.success(t('Configuration exported'), result.path)
            })
          }
        >
          <Download /> {t('Export…')}
        </Button>
      </Row>
      <Row label={t('Import configuration')} hint={t('Adds what this installation lacks and replaces the settings. Keys and secrets have to be entered again.')}>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            void run('import', async () => {
              const summary = await invoke('data:import')
              if (!summary) return
              await useSettings.getState().load()
              notify.success(
                t('Configuration imported'),
                [
                  t('{profiles} accounts, {servers} MCP servers, {agents} agents, {prices} prices added.', {
                    profiles: summary.profiles,
                    servers: summary.mcpServers,
                    agents: summary.agents,
                    prices: summary.prices
                  }),
                  ...summary.skipped
                ].join('\n')
              )
            })
          }
        >
          <Upload /> {t('Import…')}
        </Button>
      </Row>
      <Row label={t('Purge the history')} hint={t('Deletes past sessions, their transcripts and usage records. Running sessions are kept.')}>
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmPurge(true)}>
          <Trash2 /> {t('Purge…')}
        </Button>
      </Row>
      <Dialog open={confirmPurge} onOpenChange={setConfirmPurge}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Purge the history?')}</DialogTitle>
            <DialogDescription>{t('Past sessions, transcripts, usage and limit readings are deleted for good.')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmPurge(false)}>
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                void run('purge', async () => {
                  const { sessions } = await invoke('data:purge')
                  setConfirmPurge(false)
                  notify.success(t('History purged'), t('{count} sessions deleted.', { count: sessions }))
                })
              }
            >
              {t('Purge')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
