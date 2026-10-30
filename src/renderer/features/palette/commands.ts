import { t } from "@shared/i18n";
import { effectiveBindings, formatCombo } from "@shared/keybindings";
import { PROFILE_KIND_LABELS } from "@shared/profiles";
import { useAgents, ENDED_STATUSES } from "@/stores/agents";
import { useAgentDialog } from "@/stores/agent-dialog";
import { useNextSession } from "@/stores/next-session";
import { fromAgent } from "@/lib/next-session";
import { useSavedAgents } from "@/stores/saved-agents";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { useMcp } from "@/stores/mcp";
import { usePalette } from "@/stores/palette";
import { useProfiles, profileById } from "@/stores/profiles";
import { useSettings } from "@/stores/settings";
import { useTerminals } from "@/stores/terminals";
import { useWorkspace } from "@/stores/workspace";

export interface Command {
  id: string;
  title: string;
  /** Translated group heading. */
  group: string;
  shortcut?: string;
  run: () => void;
}

/** Every action the palette offers, built from the current state each time it opens. */
export function buildCommands(): Command[] {
  const layout = useLayout.getState();
  const workspace = useWorkspace.getState().info;
  const agents = useAgents.getState();
  const profiles = useProfiles.getState().profiles;
  const settings = useSettings.getState();
  const active = agents.activeId ? agents.sessions[agents.activeId] : undefined;
  const showAgentPanel = () => layout.setAgentPanelOpen(true);
  const keys = effectiveBindings(settings.settings.shortcuts.bindings);
  const sc = (id: string) =>
    keys[id] ? { shortcut: formatCombo(keys[id] as string) } : {};

  const commands: Command[] = [
    {
      id: "go.chat",
      title: t("Go to Chat"),
      group: t("Go to"),
      ...sc("view.chat"),
      run: () => layout.showCenter("chat"),
    },
    {
      id: "go.files",
      title: t("Go to Explorer"),
      group: t("Go to"),
      ...sc("view.explorer"),
      run: () => layout.showSidebarTab("files"),
    },
    {
      id: "go.search",
      title: t("Search in files"),
      group: t("Go to"),
      ...sc("view.search"),
      run: () => layout.showSidebarTab("search"),
    },
    {
      id: "go.file",
      title: t("Go to file…"),
      group: t("Go to"),
      ...sc("file.quickOpen"),
      run: () => setTimeout(() => usePalette.getState().show("files")),
    },
    {
      id: "go.board",
      title: t("Go to Agents board"),
      group: t("Go to"),
      run: () => layout.showCenter("tasks"),
    },
    {
      id: "go.accounts",
      title: t("Go to Accounts"),
      group: t("Go to"),
      run: () => layout.showSettings("accounts"),
    },
    {
      id: "go.mcp",
      title: t("Go to MCP servers"),
      group: t("Go to"),
      run: () => layout.showSettings("mcp"),
    },
    {
      id: "go.supervision",
      title: t("Go to Supervision"),
      group: t("Go to"),
      run: () => layout.showCenter("supervision"),
    },
    {
      id: "go.settings",
      title: t("Open Settings"),
      group: t("Go to"),
      ...sc("view.settings"),
      run: () => layout.showCenter("settings"),
    },

    {
      id: "view.sidebar",
      title: t("Toggle sidebar"),
      group: t("View"),
      ...sc("layout.sidebar"),
      run: layout.toggleSidebar,
    },
    {
      id: "view.terminal",
      title: t("Toggle terminal"),
      group: t("View"),
      ...sc("layout.terminal"),
      run: layout.toggleTerminal,
    },
    {
      id: "view.agent",
      title: t("Toggle agent panel"),
      group: t("View"),
      ...sc("layout.agentPanel"),
      run: layout.toggleAgentPanel,
    },
    ...(["light", "dark", "system"] as const)
      .filter((theme) => theme !== settings.settings.appearance.theme)
      .map(
        (theme): Command => ({
          id: `view.theme.${theme}`,
          title:
            theme === "system"
              ? t("Use the system theme")
              : theme === "dark"
                ? t("Use the dark theme")
                : t("Use the light theme"),
          group: t("View"),
          run: () => void settings.update("appearance.theme", theme),
        }),
      ),

    {
      id: "ws.open",
      title: t("Open folder…"),
      group: t("Workspace"),
      ...sc("file.openFolder"),
      run: () => void useWorkspace.getState().pick(),
    },
    {
      id: "ws.terminal",
      title: t("New terminal"),
      group: t("Workspace"),
      run: () => {
        layout.setTerminalOpen(true);
        void useTerminals.getState().create();
      },
    },
    ...(useEditor.getState().active
      ? [
          {
            id: "ws.save",
            title: t("Save file"),
            group: t("Workspace"),
            ...sc("file.save"),
            run: () => void useEditor.getState().save(),
          },
        ]
      : []),

    {
      id: "new.session",
      title: t("New agent session"),
      group: t("Create"),
      run: () => {
        agents.select(null);
        showAgentPanel();
      },
    },
    {
      id: "new.task",
      title: t("New task…"),
      group: t("Create"),
      run: () => layout.request("new-task"),
    },
    {
      id: "new.agent",
      title: t("New saved agent…"),
      group: t("Create"),
      // Created from the agent panel's point of view: it answers the next session.
      run: () =>
        useAgentDialog.getState().open("new", (agent) => {
          useNextSession.getState().save(useWorkspace.getState().info?.root ?? "", fromAgent(agent));
          agents.select(null);
          showAgentPanel();
        }),
    },
    {
      id: "new.account",
      title: t("Add account…"),
      group: t("Create"),
      run: () => layout.request("new-account"),
    },
    {
      id: "new.mcp",
      title: t("Add MCP server…"),
      group: t("Create"),
      run: () => layout.request("new-mcp"),
    },
    {
      id: "new.import",
      title: t("Import claude_desktop_config.json…"),
      group: t("Create"),
      run: () => {
        layout.showSettings("mcp");
        void useMcp.getState().startImport();
      },
    },
  ];

  if (active && !ENDED_STATUSES.has(active.info.status)) {
    commands.push(
      {
        id: "agent.interrupt",
        title: t("Interrupt the active agent"),
        group: t("Agents"),
        run: () => void agents.interrupt(),
      },
      {
        id: "agent.stop",
        title: t("Stop the active agent session"),
        group: t("Agents"),
        run: () => void agents.stop(),
      },
    );
  }
  for (const id of agents.order) {
    const view = agents.sessions[id];
    if (!view || id === agents.activeId) continue;
    const profile = profileById(profiles, view.info.profileId);
    commands.push({
      id: `session.${id}`,
      title: ENDED_STATUSES.has(view.info.status)
        ? t("Switch to {name} · {model} (ended)", {
            name: profile?.name ?? t("agent"),
            model: view.info.model || t("default model"),
          })
        : t("Switch to {name} · {model}", {
            name: profile?.name ?? t("agent"),
            model: view.info.model || t("default model"),
          }),
      group: t("Sessions"),
      run: () => {
        agents.select(id);
        showAgentPanel();
      },
    });
  }
  for (const agent of useSavedAgents.getState().agents) {
    const profile = profileById(profiles, agent.profileId);
    if (!workspace || !profile?.usable) continue;
    commands.push({
      id: `agent.start.${agent.id}`,
      title: t("Chat with {agent} ({account}, {kind})", {
        agent: agent.name,
        account: profile.name,
        kind: PROFILE_KIND_LABELS[profile.kind],
      }),
      group: t("Agents"),
      run: () => {
        showAgentPanel();
        void agents.start({
          profileId: agent.profileId,
          model: agent.model,
          effort: agent.effort,
          permissionLevel: agent.permissionLevel,
          systemPrompt: agent.systemPrompt,
          mcpTools: agent.mcpTools,
          agentId: agent.id,
        });
      },
    });
  }
  return commands;
}
