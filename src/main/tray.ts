import { join } from 'node:path'
import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { t } from '@shared/i18n'

let tray: Tray | null = null
let quitting = false

app.on('before-quit', () => {
  quitting = true
})

function icon(): Electron.NativeImage {
  const file = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png')
  const image = nativeImage.createFromPath(file)
  return image.isEmpty() ? image : image.resize({ width: 16, height: 16 })
}

function show(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** The tray icon, created on first use; its menu follows the interface language. */
function ensureTray(win: BrowserWindow): void {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(menu(win))
    return
  }
  tray = new Tray(icon())
  tray.setToolTip('Clyde')
  tray.setContextMenu(menu(win))
  tray.on('click', () => show(win))
}

function menu(win: BrowserWindow): Electron.Menu {
  return Menu.buildFromTemplate([
    { label: t('Show Clyde'), click: () => show(win) },
    { type: 'separator' },
    { label: t('Quit'), click: () => app.quit() }
  ])
}

/**
 * Settings › General › On close: "tray" hides the window to the system tray instead of
 * quitting; the tray menu brings it back or quits.
 */
export function handleClose(win: BrowserWindow, behavior: () => 'quit' | 'tray'): void {
  win.on('close', (event) => {
    if (quitting || behavior() !== 'tray') return
    event.preventDefault()
    ensureTray(win)
    win.hide()
  })
}
