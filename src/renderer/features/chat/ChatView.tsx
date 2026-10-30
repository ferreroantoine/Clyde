import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FolderInput, History, MessagesSquare, Plug } from 'lucide-react'
import { t, tk } from '@shared/i18n'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/features/settings/controls'
import { SessionLimitLine } from '@/features/limits/LimitGauge'
import { tokens, usd } from '@/features/agent-panel/SessionPane'
import { useBoard } from '@/stores/board'
import { useChat, type ChatTarget } from '@/stores/chat'
import { useProfiles } from '@/stores/profiles'
import { useWorkspace } from '@/stores/workspace'
import { useSettings } from '@/stores/settings'
import { enter, swap } from '@/lib/motion'
import { ConversationList } from './ConversationList'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { TargetPicker } from './TargetPicker'

const SUGGESTIONS = [
  tk('Explain a concept I keep mixing up'),
  tk('Review this snippet and suggest improvements'),
  tk('Draft a clear commit message for my changes'),
  tk('Compare two approaches and recommend one')
]

/** What the conversation used: plan points on a subscription, cost on an API account. */
function UsageLine({ conversationId }: { conversationId: string }) {
  const usage = useChat((s) => s.usage[conversationId])
  if (!usage || usage.inputTokens + usage.outputTokens === 0) return null
  return (
    <span className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums" aria-label={t('Usage of this conversation')}>
      {usage.billing === 'subscription' ? (
        <SessionLimitLine usage={usage.limits} />
      ) : usage.billing === 'api' ? (
        <span>{usage.costEstimated ? t('≈ {cost}', { cost: usd(usage.costUsd) }) : usd(usage.costUsd)}</span>
      ) : null}
      <span>
        {usage.billing === 'local' ? '' : '· '}
        {t('{count} tokens', { count: tokens(usage.inputTokens + usage.outputTokens) })}
      </span>
    </span>
  )
}

/** How full the model's context is in this conversation, as last reported. */
function ContextLine({ conversationId }: { conversationId: string }) {
  const context = useChat((s) => {
    const sessionId = s.live[conversationId]?.sessionId
    return sessionId ? s.streams[sessionId]?.context : undefined
  })
  if (!context?.window) return null
  const pct = Math.min(100, Math.round((context.tokens / context.window) * 100))
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums"
      title={t('{used} of {window} tokens of context', { used: tokens(context.tokens), window: tokens(context.window) })}
      data-testid="chat-context"
    >
      {t('Context')}
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('Context used')}>
        <span className={pct >= 80 ? 'block h-full rounded-full bg-warning' : 'block h-full rounded-full bg-primary/70'} style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  )
}

/** The Chat view: conversation list, the conversation at reading width, and the composer. */
export function ChatView() {
  const activeId = useChat((s) => s.activeId)
  const conversation = useChat((s) => s.conversations.find((c) => c.id === s.activeId))
  const draftTarget = useChat((s) => s.draftTarget)
  const setDraftTarget = useChat((s) => s.setDraftTarget)
  const send = useChat((s) => s.send)
  const stop = useChat((s) => s.stop)
  const update = useChat((s) => s.update)
  const continueInProject = useChat((s) => s.continueInProject)
  const messages = useChat((s) => (s.activeId ? s.messages[s.activeId] : undefined))
  const busy = useChat((s) => (s.activeId ? !!s.live[s.activeId]?.busy : false))
  const profiles = useProfiles((s) => s.profiles)
  const agents = useBoard((s) => s.agents)
  const workspace = useWorkspace((s) => s.info)

  // A new conversation starts with the last one's agent or account, else the first usable account.
  const conversations = useChat((s) => s.conversations)
  useEffect(() => {
    if (draftTarget && profiles.some((p) => p.id === draftTarget.profileId && p.usable)) return
    const last = conversations[0]
    const first = profiles.find((p) => p.usable)
    if (last && profiles.some((p) => p.id === last.profileId && p.usable)) {
      setDraftTarget({ agentId: last.agentId, profileId: last.profileId, model: last.model })
    } else if (first) setDraftTarget({ agentId: null, profileId: first.id, model: first.defaultModel })
  }, [draftTarget, profiles, conversations, setDraftTarget])

  const target: ChatTarget | null = conversation
    ? { agentId: conversation.agentId, profileId: conversation.profileId, model: conversation.model, toolsEnabled: conversation.toolsEnabled }
    : draftTarget
  const agent = target?.agentId ? agents.find((a) => a.id === target.agentId) : undefined
  const onTarget = (next: ChatTarget) => {
    if (conversation) void update(conversation.id, { agentId: next.agentId, profileId: next.profileId, model: next.model })
    else setDraftTarget({ ...next, toolsEnabled: draftTarget?.toolsEnabled ?? false })
  }
  const toolsEnabled = !!target?.toolsEnabled
  const setTools = (on: boolean) => {
    if (conversation) void update(conversation.id, { toolsEnabled: on })
    else if (draftTarget) setDraftTarget({ ...draftTarget, toolsEnabled: on })
  }
  const historySearch = useSettings((s) => s.settings.memory.historySearch)
  const empty = !activeId || messages?.length === 0
  const noAccount = !profiles.some((p) => p.usable)

  return (
    <div className="flex h-full min-h-0">
      <ConversationList />
      <section className="flex min-w-0 flex-1 flex-col" aria-label={conversation?.title || t('New conversation')}>
        <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
          <TargetPicker target={target} onChange={onTarget} />
          {agent && agent.mcpTools.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground" title={t('Lets the model use the MCP tools allowed for this agent.')}>
              <Plug className="size-3.5" />
              {t('MCP tools')}
              <Toggle checked={toolsEnabled} onChange={setTools} label={t('MCP tools')} />
            </label>
          )}
          {historySearch && conversation && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground" title={t('Adds relevant passages of your earlier conversations to each message, found on this computer.')}>
              <History className="size-3.5" />
              {t('Past conversations')}
              <Toggle checked={conversation.useHistory} onChange={(on) => void update(conversation.id, { useHistory: on })} label={t('Past conversations')} />
            </label>
          )}
          <div className="ml-auto flex items-center gap-3">
            {conversation && <ContextLine conversationId={conversation.id} />}
            {conversation && <UsageLine conversationId={conversation.id} />}
            {conversation && (
              <Button
                size="xs"
                variant="outline"
                disabled={!workspace || busy}
                title={workspace ? t('Opens an agent session in {folder} with this conversation as context.', { folder: workspace.name }) : t('Open a folder first')}
                onClick={() => void continueInProject()}
              >
                <FolderInput /> {t('Continue in the project')}
              </Button>
            )}
          </div>
        </header>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={activeId ?? 'new'} variants={swap} initial="hidden" animate="shown" exit="gone" className="flex min-h-0 flex-1 flex-col">
            {empty ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6">
                <motion.div variants={enter} initial="hidden" animate="shown" className="flex flex-col items-center gap-3 text-center">
                  <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                    <MessagesSquare className="size-6" />
                  </span>
                  <h1 className="text-xl font-semibold tracking-tight">{t('What can I help with?')}</h1>
                  <p className="max-w-md text-sm text-muted-foreground">
                    {noAccount
                      ? t('Add an account in Settings › Accounts & providers to start chatting.')
                      : t('A plain conversation: it reads what you attach, but never changes your files or runs commands.')}
                  </p>
                </motion.div>
                {!noAccount && (
                  <div className="grid w-full max-w-[640px] gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((s, i) => (
                      <motion.button
                        key={s}
                        type="button"
                        variants={enter}
                        initial="hidden"
                        animate="shown"
                        transition={{ delay: 0.05 * i }}
                        onClick={() => void send(t(s), [])}
                        className="press press-soft rounded-xl border bg-card px-4 py-3 text-left text-[13px] text-muted-foreground shadow-xs hover:border-primary/40 hover:text-foreground"
                      >
                        {t(s)}
                      </motion.button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              activeId && <MessageList conversationId={activeId} />
            )}
          </motion.div>
        </AnimatePresence>
        <Composer
          busy={busy}
          disabled={noAccount || !target}
          onSend={send}
          onStop={() => void stop()}
          placeholder={agent ? t('Message {name}…', { name: agent.name }) : t('Message…')}
        />
      </section>
    </div>
  )
}
