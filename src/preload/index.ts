import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('atelier', {
  platform: process.platform
})
