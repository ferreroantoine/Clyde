import { useEffect } from 'react'
import { notify } from '@/stores/notifications'

const REPEAT_MS = 5000

/** Browser warnings that reach window.onerror but are not failures (Monaco's layout triggers this one). */
const BENIGN = /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/

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
    const onError = (e: ErrorEvent) => {
      if (!e.error && BENIGN.test(e.message)) return
      report('Something went wrong', e.error ?? e.message)
    }
    const onRejection = (e: PromiseRejectionEvent) => report('An action failed', e.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
}
