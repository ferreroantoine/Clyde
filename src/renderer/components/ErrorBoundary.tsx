import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  /** Names what failed, e.g. "Supervision". */
  scope: string
  children: ReactNode
}

/** Shows a readable error and a way back instead of a blank window when a view crashes. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.scope}]`, error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <TriangleAlert className="size-6 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('{scope} ran into an error', { scope: this.props.scope })}</p>
          <p className="max-w-md font-mono text-xs break-words text-muted-foreground">{error.message}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
            {t('Try again')}</Button>
          <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
            {t('Reload the window')}</Button>
        </div>
      </div>
    )
  }
}
