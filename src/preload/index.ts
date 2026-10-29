import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/ipc/channels'
import type { ClydeApi } from '@shared/ipc/api'

const invokeAllowed = new Set<string>(INVOKE_CHANNELS)
const eventAllowed = new Set<string>(EVENT_CHANNELS)

const api: ClydeApi = {
  platform: process.platform,
  invoke: (channel, ...args) => {
    if (!invokeAllowed.has(channel)) return Promise.reject(new Error(`Unknown channel ${channel}`))
    return ipcRenderer.invoke(channel, args[0])
  },
  on: (channel, listener) => {
    if (!eventAllowed.has(channel)) throw new Error(`Unknown event ${channel}`)
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('clyde', api)
