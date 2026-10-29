import { useEffect } from 'react'
import { t } from '@shared/i18n'
import { notify } from '@/stores/notifications'

const REPEAT_MS = 5000

/** Turns uncaught renderer errors into toasts, once per message every few seconds. */
export function useGlobalErrorToasts(): void {
  useEffect(() => {
    const seen = new Map<string, number>()
    const report = (title: string, err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      const now = Date.now()
      if ((seen.get(message) ?? 0) > now - REPEAT_MS) return
      seen.set(message, now)
      notify.error(title, err)
    }
    const onError = (e: ErrorEvent) => report(t('Something went wrong'), e.error ?? e.message)
    const onRejection = (e: PromiseRejectionEvent) => report(t('An action failed'), e.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
}
