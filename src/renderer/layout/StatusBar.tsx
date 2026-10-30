import { Bot, FolderGit2, Moon, PanelBottom, PanelLeft, PanelRight, Sun } from 'lucide-react'
import { t, tn } from '@shared/i18n'
import { effectiveBindings, formatCombo } from '@shared/keybindings'
import { isEnded } from '@shared/agent'
import { IconButton } from '@/components/IconButton'
import { useLayout } from '@/stores/layout'
import { useSettings } from '@/stores/settings'
import { useWorkspace } from '@/stores/workspace'
import { useEditor } from '@/stores/editor'
import { useResolvedTheme } from '@/lib/theme'
import { useAgents } from '@/stores/agents'
import { profileById, useProfiles } from '@/stores/profiles'
import { ProfileBadge } from '@/components/ProfileBadge'
import { STATUS_LABELS } from '@/features/agent-panel/SessionPane'
import { MiniGauge } from '@/features/limits/LimitGauge'
import { useLimits } from '@/stores/limits'

function ActiveAgent() {
  const info = useAgents((s) => (s.activeId ? s.sessions[s.activeId]?.info : undefined))
  const running = useAgents((s) => Object.values(s.sessions).filter((v) => !isEnded(v.info.status)).length)
  const profile = profileById(useProfiles((s) => s.profiles), info?.profileId)
  if (!info || !profile) {
    return (
      <span className="flex items-center gap-1.5 opacity-70">
        <Bot className="size-3" />
        {running > 0 ? tn('{count} agent running', '{count} agents running', running) : t('No active agent')}
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-agent-status={info.status}>
      <ProfileBadge profile={profile} />
      <span className="opacity-70">{t(STATUS_LABELS[info.status])}</span>
      {running > 1 && <span className="opacity-70">· {t('{count} more running', { count: running - 1 })}</span>}
      <ProfileGauges profileId={profile.id} color={profile.color} />
    </span>
  )
}

/** 5-hour and weekly use of the active agent's plan, in the account's color. */
function ProfileGauges({ profileId, color }: { profileId: string; color: string }) {
  const limits = useLimits((s) => s.profiles[profileId])
  const enabled = useSettings((s) => s.settings.usage.statusBarGauges)
  if (!enabled || !limits) return null
  const [five, week] = limits.windows
  return (
    <span className="ml-1 flex items-center gap-2 border-l border-foreground/10 pl-2" aria-label={t('Plan usage')}>
      {five && <MiniGauge state={five} color={color} short={t('5h')} />}
      {week && <MiniGauge state={week} color={color} short={t('Week')} />}
    </span>
  )
}

export function StatusBar() {
  const workspace = useWorkspace((s) => s.info)
  const cursor = useEditor((s) => s.cursor)
  const language = useEditor((s) => s.tabs.find((t) => t.path === s.active)?.language)
  const theme = useResolvedTheme((s) => s.theme)
  const updateSetting = useSettings((s) => s.update)
  const layout = useLayout()
  const bindings = effectiveBindings(useSettings((s) => s.settings.shortcuts.bindings))
  const shortcutOf = (id: string) => (bindings[id] ? { shortcut: formatCombo(bindings[id] as string) } : {})

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t bg-chrome px-2 text-[11px] text-chrome-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1.5 truncate">
          <FolderGit2 className="size-3" />
          {workspace ? workspace.name : t('No folder open')}
        </span>
        <ActiveAgent />
      </div>
      <div className="flex items-center gap-0.5">
        {cursor && (
          <span className="mr-2 tabular-nums">
            {t('Ln {line}, Col {column}', { line: cursor.line, column: cursor.column })}
          </span>
        )}
        {language && <span className="mr-3">{language}</span>}
        <IconButton
          icon={PanelLeft}
          label={t('Toggle sidebar')}
          {...shortcutOf('layout.sidebar')}
          side="top"
          active={layout.sidebarOpen}
          onClick={layout.toggleSidebar}
          className="size-5"
        />
        <IconButton
          icon={PanelBottom}
          label={t('Toggle terminal')}
          {...shortcutOf('layout.terminal')}
          side="top"
          active={layout.terminalOpen}
          onClick={layout.toggleTerminal}
          className="size-5"
        />
        <IconButton
          icon={PanelRight}
          label={t('Toggle agent panel')}
          {...shortcutOf('layout.agentPanel')}
          side="top"
          active={layout.agentPanelOpen}
          onClick={layout.toggleAgentPanel}
          className="size-5"
        />
        <IconButton
          icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')}
          side="top"
          onClick={() => void updateSetting('appearance.theme', theme === 'dark' ? 'light' : 'dark')}
          className="size-5"
        />
      </div>
    </footer>
  )
}
