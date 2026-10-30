import { join } from 'node:path'
import { app, dialog, Menu, nativeImage, Notification, Tray, type BrowserWindow } from 'electron'
import { t, tn } from '@shared/i18n'

let tray: Tray | null = null
let quitting = false
/** The "still running" notice is shown once per run. */
let told = false

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

export interface BackgroundDeps {
  /** Settings › General › On close. */
  behavior: () => 'quit' | 'tray'
  /** Agents working right now: quitting cuts them (they can be resumed). */
  busy: () => number
}

/** Asks before quitting while agents work; true when the user still wants to quit. */
function confirmQuit(win: BrowserWindow | null, busy: number): boolean {
  if (busy === 0) return true
  const options = {
    type: 'warning' as const,
    buttons: [t('Quit'), t('Cancel')],
    defaultId: 1,
    cancelId: 1,
    title: 'Clyde',
    message: tn('{count} agent is still working.', '{count} agents are still working.', busy),
    detail: t('Quitting interrupts them. You can resume them from the agent panel when Clyde starts again.')
  }
  const choice = win && !win.isDestroyed() ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options)
  return choice === 0
}

function quit(win: BrowserWindow, deps: BackgroundDeps): void {
  if (!confirmQuit(win, deps.busy())) return
  app.quit()
}

/** The tray icon, created on first use; its menu follows the interface language and the agents at work. */
function ensureTray(win: BrowserWindow, deps: BackgroundDeps): void {
  if (!tray || tray.isDestroyed()) {
    tray = new Tray(icon())
    tray.setToolTip('Clyde')
    tray.on('click', () => show(win))
  }
  tray.setContextMenu(menu(win, deps))
}

/** Rebuilds the tray menu, e.g. when the number of agents at work changes. */
export function refreshTray(win: BrowserWindow, deps: BackgroundDeps): void {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(menu(win, deps))
}

function menu(win: BrowserWindow, deps: BackgroundDeps): Electron.Menu {
  const busy = deps.busy()
  return Menu.buildFromTemplate([
    { label: t('Show Clyde'), click: () => show(win) },
    { type: 'separator' },
    { label: busy ? tn('{count} agent working', '{count} agents working', busy) : t('No agent working'), enabled: false },
    { type: 'separator' },
    { label: t('Quit Clyde'), click: () => quit(win, deps) }
  ])
}

/**
 * Closing the window hides it to the system tray (the default): agents keep working and the
 * tray brings it back. With "quit", closing quits, after asking if agents are working.
 */
export function handleClose(win: BrowserWindow, deps: BackgroundDeps): void {
  // The tray is there from the start, so Clyde can always be found and quit.
  if (deps.behavior() === 'tray') ensureTray(win, deps)
  win.on('close', (event) => {
    if (quitting) return
    if (deps.behavior() !== 'tray') {
      if (!confirmQuit(win, deps.busy())) event.preventDefault()
      return
    }
    event.preventDefault()
    ensureTray(win, deps)
    win.hide()
    if (!told && Notification.isSupported()) {
      told = true
      const busy = deps.busy()
      const note = new Notification({
        title: t('Clyde keeps running'),
        body: busy
          ? tn('{count} agent goes on working. Click the tray icon to come back.', '{count} agents go on working. Click the tray icon to come back.', busy)
          : t('Click the tray icon to come back, or quit from its menu.')
      })
      note.on('click', () => show(win))
      note.show()
    }
  })
}

/** Settings changed: the tray follows the close behavior. */
export function syncTray(win: BrowserWindow, deps: BackgroundDeps): void {
  if (deps.behavior() === 'tray') ensureTray(win, deps)
  else if (tray && !tray.isDestroyed()) {
    tray.destroy()
    tray = null
  }
}
