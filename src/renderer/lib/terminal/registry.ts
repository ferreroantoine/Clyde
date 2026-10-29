import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { tokenToHex, type ResolvedTheme } from '@/lib/theme'

const THEMES: Record<ResolvedTheme, ITheme> = {
  // `background` is replaced at runtime by the --terminal token so the terminal matches its panel.
  light: {
    background: '#fbfbfc',
    foreground: '#2b2f38',
    cursor: '#4f5bd5',
    cursorAccent: '#fbfbfc',
    selectionBackground: '#d9defa',
    black: '#2b2f38',
    red: '#c4314b',
    green: '#2e8b57',
    yellow: '#b5860b',
    blue: '#3b5bdb',
    magenta: '#9c36b5',
    cyan: '#0c8599',
    white: '#c9ccd3',
    brightBlack: '#6b7080',
    brightRed: '#e03e5a',
    brightGreen: '#37a169',
    brightYellow: '#d39e1a',
    brightBlue: '#5272f2',
    brightMagenta: '#b44fd1',
    brightCyan: '#1098ad',
    brightWhite: '#f1f2f5'
  },
  dark: {
    background: '#131418',
    foreground: '#d7dae0',
    cursor: '#8a94f0',
    cursorAccent: '#131418',
    selectionBackground: '#34396a',
    black: '#1e2026',
    red: '#f2777a',
    green: '#7fd1a0',
    yellow: '#f0c674',
    blue: '#82a6f5',
    magenta: '#c899f2',
    cyan: '#70c8d8',
    white: '#c5c8ce',
    brightBlack: '#5c6170',
    brightRed: '#ff8f91',
    brightGreen: '#97e2b4',
    brightYellow: '#f7d58c',
    brightBlue: '#9db8fa',
    brightMagenta: '#d8b0f7',
    brightCyan: '#8ad8e6',
    brightWhite: '#f4f5f7'
  }
}

function themeFor(theme: ResolvedTheme): ITheme {
  const base = THEMES[theme]
  const background = tokenToHex('--terminal') ?? base.background
  return { ...base, ...(background ? { background, cursorAccent: background } : {}) }
}

export interface TerminalHandlers {
  onInput: (data: string) => void
  onResize: (cols: number, rows: number) => void
}

interface Entry {
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  opened: boolean
  pending: string[]
}

const entries = new Map<string, Entry>()
let currentTheme: ResolvedTheme = 'light'
let currentFontSize = 13

/**
 * xterm instances live outside React so switching tabs or collapsing the panel
 * never loses scrollback. Components only attach and detach the host element.
 */
export const terminals = {
  create(id: string, opts: { readOnly: boolean; windowsBuild: number | null }, handlers: TerminalHandlers): void {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono Variable', 'Cascadia Mono', monospace",
      fontSize: currentFontSize,
      lineHeight: 1.25,
      cursorBlink: !opts.readOnly,
      disableStdin: opts.readOnly,
      scrollback: 10000,
      allowProposedApi: false,
      theme: themeFor(currentTheme),
      ...(opts.windowsBuild ? { windowsPty: { backend: 'conpty' as const, buildNumber: opts.windowsBuild } } : {})
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.onData(handlers.onInput)
    term.onResize(({ cols, rows }) => handlers.onResize(cols, rows))
    // Windows Terminal conventions: Ctrl+C copies when there is a selection, Ctrl+V pastes.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true
      const key = e.key.toLowerCase()
      if (key === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      if (key === 'v' && !opts.readOnly) {
        void navigator.clipboard.readText().then((text) => text && term.paste(text))
        return false
      }
      return true
    })
    const host = document.createElement('div')
    host.className = 'h-full w-full'
    entries.set(id, { term, fit, host, opened: false, pending: [] })
  },

  attach(id: string, container: HTMLElement): void {
    const entry = entries.get(id)
    if (!entry) return
    container.appendChild(entry.host)
    if (!entry.opened) {
      entry.term.open(entry.host)
      entry.opened = true
      for (const chunk of entry.pending) entry.term.write(chunk)
      entry.pending = []
    }
    this.fit(id)
  },

  detach(id: string): void {
    entries.get(id)?.host.remove()
  },

  fit(id: string): void {
    const entry = entries.get(id)
    if (!entry?.opened || !entry.host.isConnected || entry.host.clientWidth === 0) return
    try {
      entry.fit.fit()
    } catch {
      // Fitting while hidden can throw; the next resize will fix it.
    }
  },

  focus(id: string): void {
    entries.get(id)?.term.focus()
  },

  write(id: string, data: string): void {
    const entry = entries.get(id)
    if (!entry) return
    if (entry.opened) entry.term.write(data)
    else entry.pending.push(data)
  },

  dispose(id: string): void {
    const entry = entries.get(id)
    if (!entry) return
    entry.term.dispose()
    entry.host.remove()
    entries.delete(id)
  },

  setTheme(theme: ResolvedTheme): void {
    currentTheme = theme
    const resolved = themeFor(theme)
    for (const { term } of entries.values()) term.options.theme = resolved
  },

  setFontSize(size: number): void {
    currentFontSize = size
    for (const [id, { term }] of entries) {
      term.options.fontSize = size
      this.fit(id)
    }
  }
}
