import { useState } from 'react'
import { Music } from 'lucide-react'
import { t } from '@shared/i18n'
import { fileUrl, formatBytes } from '@/lib/viewers'
import type { EditorTab } from '@/stores/editor'
import { CannotShow } from './common'

/** Chromium's own player; files it cannot decode (some MKV, MOV, codecs) get the way out. */
export default function MediaView({ tab }: { tab: EditorTab }) {
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const src = fileUrl(tab.path, tab.mtimeMs)
  if (failedFor === src) {
    return (
      <CannotShow
        path={tab.path}
        title={t('Clyde cannot play this file')}
        description={t('Its format or codec is not one Chromium reads. Your usual player can open it.')}
      />
    )
  }
  const onError = () => setFailedFor(src)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-editor p-6" data-testid="media-view">
      {tab.viewer === 'video' ? (
        <video key={src} src={src} controls className="max-h-full max-w-full rounded-md bg-black" onError={onError} />
      ) : (
        <>
          <Music className="size-10 text-muted-foreground" />
          <p className="text-sm font-medium">{tab.name}</p>
          <audio key={src} src={src} controls className="w-full max-w-md" onError={onError} />
        </>
      )}
      {tab.size !== undefined && <p className="text-[11px] text-muted-foreground tabular-nums">{formatBytes(tab.size)}</p>}
    </div>
  )
}
