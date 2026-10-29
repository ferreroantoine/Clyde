import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Download, Trash2, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { WHISPER_MODELS } from '@shared/voice'
import { Button } from '@/components/ui/button'
import { useVoice } from '@/stores/voice'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/utils'
import { Select } from './controls'

const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`)

function ProgressBar({ received, total }: { received: number; total: number }) {
  const pct = total ? Math.min(100, (received / total) * 100) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full bg-primary transition-[width] duration-200', !total && 'w-1/3 animate-pulse')} style={total ? { width: `${pct}%` } : undefined} />
    </div>
  )
}

/** whisper.cpp itself: found where, or downloadable for this system. */
export function WhisperBinaryBlock() {
  const status = useVoice((s) => s.status)
  const load = useVoice((s) => s.loadStatus)
  const install = useVoice((s) => s.installBinary)
  const cancel = useVoice((s) => s.cancelDownload)
  const progress = useVoice((s) => s.progress['whisper-cli'])
  const whisperPath = useSettings((s) => s.settings.voice.whisperPath)
  useEffect(() => {
    void load()
  }, [load, whisperPath])
  const downloading = progress?.state === 'downloading'
  const binary = status?.binary
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{t('whisper.cpp')}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {binary?.path ? <CircleCheck className="size-3.5 shrink-0 text-success" /> : <CircleAlert className="size-3.5 shrink-0 text-warning" />}
            <span className="truncate" title={binary?.path ?? undefined}>
              {binary?.path
                ? binary.source === 'downloaded'
                  ? t('Downloaded by Atelier (release b5454, CPU).')
                  : binary.source === 'custom'
                    ? t('Your build: {path}', { path: binary.path })
                    : t('Found on the PATH: {path}', { path: binary.path })
                : binary?.downloadable
                  ? t('Not installed. About 9 MB to download.')
                  : t('No official build for this system. On macOS: brew install whisper-cpp, or set the path below.')}
            </span>
          </p>
        </div>
        {binary?.downloadable && binary.source !== 'custom' && (
          downloading ? (
            <Button size="sm" variant="ghost" onClick={() => void cancel('whisper-cli')}>
              <X /> {t('Cancel')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void install()}>
              <Download /> {binary.source === 'downloaded' ? t('Download again') : t('Download')}
            </Button>
          )
        )}
      </div>
      {downloading && <ProgressBar received={progress.received} total={progress.total} />}
    </div>
  )
}

/** The models, lightest first, with their size, download progress and the chosen one. */
export function WhisperModelsBlock() {
  const status = useVoice((s) => s.status)
  const progress = useVoice((s) => s.progress)
  const download = useVoice((s) => s.downloadModel)
  const remove = useVoice((s) => s.deleteModel)
  const cancel = useVoice((s) => s.cancelDownload)
  const chosen = useSettings((s) => s.settings.voice.model)
  const update = useSettings((s) => s.update)
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{t('Whisper model')}</p>
        <p className="text-xs text-muted-foreground">{t('From the lightest to the most accurate. Models come from the whisper.cpp repository on Hugging Face and are checked after download.')}</p>
      </div>
      <ul className="divide-y rounded-lg border" role="radiogroup" aria-label={t('Whisper model')}>
        {WHISPER_MODELS.map((m) => {
          const installed = status?.models.find((x) => x.id === m.id)?.installed ?? false
          const p = progress[m.id]
          const downloading = p?.state === 'downloading'
          return (
            <li key={m.id} className="space-y-1.5 px-3 py-2">
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="whisper-model"
                  checked={chosen === m.id}
                  onChange={() => void update('voice.model', m.id)}
                  aria-label={t(m.label)}
                  className="accent-[var(--primary)]"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">
                    {t(m.label)} <span className="font-normal text-muted-foreground tabular-nums">· {mb(m.size)}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">{t(m.hint)}</p>
                </div>
                {installed ? (
                  <>
                    <span className="flex items-center gap-1 text-[11px] text-success">
                      <CircleCheck className="size-3.5" /> {t('Downloaded')}
                    </span>
                    <Button size="icon-xs" variant="ghost" aria-label={t('Delete {name}', { name: t(m.label) })} onClick={() => void remove(m.id)}>
                      <Trash2 />
                    </Button>
                  </>
                ) : downloading ? (
                  <Button size="xs" variant="ghost" onClick={() => void cancel(m.id)}>
                    <X /> {t('Cancel')}
                  </Button>
                ) : (
                  <Button size="xs" variant="outline" onClick={() => void download(m.id)}>
                    <Download /> {t('Download')}
                  </Button>
                )}
              </div>
              {downloading && (
                <div className="flex items-center gap-2 pl-7">
                  <ProgressBar received={p.received} total={p.total} />
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {mb(p.received)} / {mb(p.total || m.size)}
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The microphones the system lists; labels appear once the microphone was allowed. */
export function MicrophoneSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const read = () =>
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')))
        .catch(() => undefined)
    read()
    navigator.mediaDevices?.addEventListener('devicechange', read)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', read)
  }, [])
  return (
    <Select
      label={t('Microphone')}
      value={value}
      className="max-w-64"
      options={[
        { value: '', label: t('System default') },
        ...devices.map((d, i) => ({ value: d.deviceId, label: d.label || t('Microphone {n}', { n: i + 1 }) }))
      ]}
      onChange={onChange}
    />
  )
}

/** The hesitation words, one per comma; saved when the field loses focus. */
export function HesitationsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '))
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const words = [...new Set(text.split(/[,\n;]+/).map((w) => w.trim().toLowerCase()).filter(Boolean))].slice(0, 100)
        setText(words.join(', '))
        onChange(words)
      }}
      aria-label={t('Hesitation words')}
      rows={2}
      className="w-72 resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs shadow-xs focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    />
  )
}
