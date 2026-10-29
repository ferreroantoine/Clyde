import { BrowserWindow } from 'electron'
import type { EventChannel } from '@shared/ipc/channels'
import type { EventPayloads } from '@shared/ipc/contract'

export function broadcast<E extends EventChannel>(channel: E, payload: EventPayloads[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
