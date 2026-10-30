import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
    title: 'Clyde',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // The window may use the microphone (dictation) and write to the clipboard; nothing else.
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (contents !== win.webContents) return callback(false)
    if (permission === 'clipboard-sanitized-write') return callback(true)
    if (permission === 'media') {
      const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
      return callback(types.length > 0 && types.every((type) => type === 'audio'))
    }
    callback(false)
  })

  // Never open external links inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}
