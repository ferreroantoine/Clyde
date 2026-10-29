import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types'
import { t } from '@shared/i18n'
import { invoke } from '@/lib/ipc'
import { Row } from './controls'

export function AboutBlock() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [licenses, setLicenses] = useState<Array<{ name: string; version: string; license: string }>>([])
  useEffect(() => {
    void invoke('app:getInfo').then(setInfo)
    void invoke('app:licenses').then(setLicenses)
  }, [])
  return (
    <div>
      <Row label="Atelier" hint={t('Agent-centric IDE, multi-account and multi-provider.')}>
        <span className="font-mono text-xs tabular-nums">{info?.version}</span>
      </Row>
      <Row label={t('Runtime')}>
        <span className="font-mono text-xs text-muted-foreground">
          Electron {info?.electron} · Node {info?.node} · {info?.platform}
          {info?.distribution ? ` · ${t('distribution build')}` : ''}
        </span>
      </Row>
      <details className="py-3">
        <summary className="cursor-pointer text-sm font-medium">{t('Open-source licenses ({count})', { count: licenses.length })}</summary>
        <table className="mt-2 w-full text-xs">
          <tbody>
            {licenses.map((l) => (
              <tr key={l.name} className="border-b last:border-0">
                <td className="py-1 font-mono">{l.name}</td>
                <td className="py-1 text-muted-foreground tabular-nums">{l.version}</td>
                <td className="py-1 text-right">{l.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
