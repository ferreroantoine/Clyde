import { useEffect, useMemo } from 'react'
import { MotionConfig } from 'motion/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Shell } from '@/layout/Shell'
import { Toaster } from '@/layout/Toaster'
import { useApplyTheme, useResolvedTheme } from '@/lib/theme'
import { terminals } from '@/lib/terminal/registry'
import { useTerminals } from '@/stores/terminals'
import { useDictationShortcut, useShortcuts, type Shortcut } from '@/lib/shortcuts'
import { useMemory } from '@/stores/memory'
import { useVoice } from '@/stores/voice'
import { effectiveBindings } from '@shared/keybindings'
import { useLayout } from '@/stores/layout'
import { useSettings } from '@/stores/settings'
import { useWorkspace } from '@/stores/workspace'
import { useEditor } from '@/stores/editor'
import { useProfiles } from '@/stores/profiles'
import { useAgents } from '@/stores/agents'
import { useMcp } from '@/stores/mcp'
import { useBoard } from '@/stores/board'
import { useLimits } from '@/stores/limits'
import { useChat } from '@/stores/chat'
import { usePalette } from '@/stores/palette'
import { CommandPalette } from '@/features/palette/CommandPalette'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useGlobalErrorToasts } from '@/lib/errors'
import { invoke, on } from '@/lib/ipc'
import { chime } from '@/lib/sound'
import { useNotifications } from '@/stores/notifications'
import { describeNotice } from '@shared/notices'
import { resolveLocale, setLocale } from '@shared/i18n'
import { effectiveLevel, useSystemReducedMotion } from '@/lib/motion'

export function App() {
  const theme = useSettings((s) => s.settings.appearance.theme)
  useApplyTheme(theme)
  const { accent, density } = useSettings((s) => s.settings.appearance)
  useEffect(() => {
    document.documentElement.dataset['accent'] = accent
    document.documentElement.dataset['density'] = density
  }, [accent, density])
  // Settings › Appearance › Animations, lowered by the system "reduce motion" preference.
  const motionLevel = effectiveLevel(useSettings((s) => s.settings.appearance.animations), useSystemReducedMotion())
  useEffect(() => {
    document.documentElement.dataset['motion'] = motionLevel
  }, [motionLevel])
  const language = useSettings((s) => s.settings.general.language)
  const locale = resolveLocale(language, navigator.language)
  // Set before the children render, so they already read the new language.
  setLocale(locale)
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    void useSettings
      .getState()
      .load()
      .then(() => {
        // Settings › General › Start view.
        const view = useSettings.getState().settings.general.startView
        const layout = useLayout.getState()
        if (view === 'chat' || view === 'agents' || view === 'supervision') layout.showCenter(view)
        else layout.showCenter('editor')
      })
    // Settings › Notifications › Sounds.
    const offSounds = on('agent:event', ({ event }) => {
      if (!useSettings.getState().settings.notifications.sounds) return
      if (event.type === 'turn_end') chime('done')
      else if (event.type === 'approval_request') chime('attention')
    })
    let off: (() => void) | undefined
    let disposed = false
    void useWorkspace
      .getState()
      .init()
      .then((unsubscribe) => {
        if (disposed) unsubscribe()
        else off = unsubscribe
      })
    const offTerminals = useTerminals.getState().init()
    const offProfiles = useProfiles.getState().init()
    const offAgents = useAgents.getState().init()
    const offMcp = useMcp.getState().init()
    const offBoard = useBoard.getState().init()
    const offLimits = useLimits.getState().init()
    const offChat = useChat.getState().init()
    const offVoice = useVoice.getState().init()
    const offMemory = useMemory.getState().init()
    void invoke('app:notices')
      .then((notices) => {
        for (const n of notices) useNotifications.getState().push({ level: 'info', persistent: true, ...describeNotice(n) })
      })
      .catch(() => undefined)
    return () => {
      offBoard()
      offMemory()
      offLimits()
      offChat()
      offVoice()
      offSounds()
      offMcp()
      offAgents()
      disposed = true
      off?.()
      offTerminals()
      offProfiles()
    }
  }, [])

  const resolvedTheme = useResolvedTheme((s) => s.theme)
  const terminalFontSize = useSettings((s) => s.settings.terminal.fontSize)
  useEffect(() => terminals.setTheme(resolvedTheme), [resolvedTheme])
  useEffect(() => terminals.setFontSize(terminalFontSize), [terminalFontSize])
  const { fontFamily: terminalFont, scrollback } = useSettings((s) => s.settings.terminal)
  useEffect(() => terminals.setOptions({ fontFamily: terminalFont, scrollback }), [terminalFont, scrollback])

  const overrides = useSettings((s) => s.settings.shortcuts.bindings)
  const shortcuts = useMemo<Shortcut[]>(() => {
    const layout = useLayout.getState
    const actions: Record<string, () => void> = {
      'view.palette': () => usePalette.getState().show('all'),
      'view.paletteAlt': () => usePalette.getState().show('all'),
      'file.quickOpen': () => usePalette.getState().show('files'),
      'file.save': () => void useEditor.getState().save(),
      'file.openFolder': () => void useWorkspace.getState().pick(),
      'view.chat': () => layout().showCenter('chat'),
      'view.explorer': () => layout().showSidebarTab('files'),
      'view.search': () => layout().showSidebarTab('search'),
      'view.settings': () => layout().showSettings(),
      'layout.sidebar': () => layout().toggleSidebar(),
      'layout.terminal': () => layout().toggleTerminal(),
      'layout.terminalAlt': () => layout().toggleTerminal(),
      'layout.agentPanel': () => layout().toggleAgentPanel()
    }
    return Object.entries(effectiveBindings(overrides))
      .filter(([id, combo]) => combo && actions[id])
      .map(([id, combo]) => ({ combo, run: actions[id] as () => void }))
  }, [overrides])
  useShortcuts(shortcuts)
  // Settings › Voice: click-to-toggle or hold-to-talk on the dictation shortcut.
  const dictationActions = useMemo(() => {
    const voice = useVoice.getState
    return { start: () => void voice().start(), stop: () => void voice().stop(), toggle: () => void voice().toggle() }
  }, [])
  useDictationShortcut(effectiveBindings(overrides)['voice.toggle'], useSettings((s) => s.settings.voice.mode) === 'hold', dictationActions)
  useGlobalErrorToasts()

  return (
    // Keyed on the language so every screen renders again in it.
    <MotionConfig reducedMotion={motionLevel === 'full' ? 'never' : 'always'} skipAnimations={motionLevel === 'off'}>
      <TooltipProvider key={locale} delayDuration={400}>
        <ErrorBoundary scope="Atelier">
          <Shell />
        </ErrorBoundary>
        <CommandPalette />
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  )
}
