import { useEffect, useState } from 'react'
import { CircleCheck, LoaderCircle, ShieldCheck } from 'lucide-react'
import type { Profile } from '@shared/profiles'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { TerminalView } from '@/features/terminal/TerminalView'
import { invoke, on } from '@/lib/ipc'
import { terminals } from '@/lib/terminal/registry'
import { notify } from '@/stores/notifications'
import { useProfiles } from '@/stores/profiles'

/**
 * Runs `claude auth login` for one profile in an embedded terminal. Claude Code handles the
 * whole flow and writes the credentials into the profile's own folder; Atelier only relays keystrokes.
 */
export function LoginDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const test = useProfiles((s) => s.test)
  const finish = () => {
    if (profile) void test(profile.id)
    onClose()
  }
  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && finish()}>
      <DialogContent className="gap-3 sm:max-w-3xl">
        {profile && <LoginSession key={profile.id} profile={profile} onFailed={onClose} onDone={finish} />}
      </DialogContent>
    </Dialog>
  )
}

function LoginSession({ profile, onFailed, onDone }: { profile: Profile; onFailed: () => void; onDone: () => void }) {
  const [ptyId, setPtyId] = useState<string | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)

  useEffect(() => {
    let id: string | null = null
    let disposed = false
    const offExit = on('pty:exit', (e) => {
      if (e.id === id) setExitCode(e.exitCode)
    })
    invoke('profiles:login', { id: profile.id, cols: 90, rows: 20 })
      .then((info) => {
        if (disposed) {
          void invoke('pty:kill', { id: info.id }).catch(() => undefined)
          return
        }
        id = info.id
        terminals.create(
          info.id,
          { readOnly: false, windowsBuild: info.windowsBuild },
          {
            onInput: (data) => void invoke('pty:write', { id: info.id, data }).catch(() => undefined),
            onResize: (cols, rows) => void invoke('pty:resize', { id: info.id, cols, rows }).catch(() => undefined)
          }
        )
        setPtyId(info.id)
      })
      .catch((err) => {
        notify.error('Could not start Claude Code', err)
        onFailed()
      })
    return () => {
      disposed = true
      offExit()
      if (id) {
        void invoke('pty:kill', { id }).catch(() => undefined)
        terminals.dispose(id)
      }
    }
  }, [profile, onFailed])

  return (
    <>
      <DialogHeader>
        <DialogTitle>Sign in: {profile.name}</DialogTitle>
        <DialogDescription className="flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Claude Code’s own login runs below and opens your browser. Atelier never sees your credentials; they stay in
          this account’s folder.
        </DialogDescription>
      </DialogHeader>
      <div className="h-80 overflow-hidden rounded-lg border bg-terminal py-1">
        {ptyId ? (
          <TerminalView id={ptyId} focused />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
          </div>
        )}
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">
          {exitCode === null ? (
            'Follow the steps in the terminal. Links open in your browser.'
          ) : exitCode === 0 ? (
            <span className="flex items-center gap-1.5 text-success">
              <CircleCheck className="size-3.5" /> Claude Code finished. Close to test the connection.
            </span>
          ) : (
            `Claude Code exited with code ${exitCode}.`
          )}
        </span>
        <Button onClick={onDone}>{exitCode === null ? 'Close' : 'Done'}</Button>
      </DialogFooter>
    </>
  )
}
