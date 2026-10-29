# Atelier: architecture and plan (approved)

> Spec: [SPEC.md](SPEC.md). Phase status: [README](../README.md#status).

## Context
The repository started empty. The goal is a Windows desktop IDE built around AI agents: several accounts and providers used in parallel, several agents on one repo (each in its own git worktree), live supervision, and MCP tools allowed per agent. The stack is set by the spec. This plan fixes the architecture, the file tree and the defaults so that Phase 1 can start.

### Decisions made with the project owner
- **Claude subscription profiles: "Both, flagged".** Profiles can use a claude.ai login or an API key. Subscription profiles carry a "personal use" badge. A distribution build (`ATELIER_DISTRIBUTION=1` at build time) turns them off, because the Agent SDK docs forbid third-party products from offering claude.ai login unless Anthropic has approved it.
- **Native deps.** The plan was to install VS 2022 Build Tools and Python 3 and rebuild better-sqlite3 with `@electron/rebuild`. In practice better-sqlite3 13 and node-pty 1.1.0 both ship N-API prebuilds that load in Electron without a rebuild, so `@electron/rebuild` was dropped. A plain `npm install` still runs `node-gyp rebuild` for better-sqlite3 (build tools needed); `npm run install:prebuilt` skips it.
- **UI language: English.** The UI and README are in English.
- **Claude Code settings: all sources** (user + project + local, same as running `claude`). Because profile settings may contain allow rules, the IDE gates calls with a programmatic `PreToolUse` hook rather than `canUseTool` alone. The docs say: "To gate every tool call, use a PreToolUse hook instead."

### Facts checked in the docs (Oct 2026)
- `CLAUDE_CONFIG_DIR` gives each account its own config dir, with its own settings, history and claude.ai login or API key. On Windows, credentials live in `<CLAUDE_CONFIG_DIR>\.credentials.json`.
- `@anthropic-ai/claude-agent-sdk` (0.3.312) bundles the native Claude Code binary as an optional dependency. `pathToClaudeCodeExecutable` overrides it.
- Options used: `env`, `cwd`, `model`, `systemPrompt`, `permissionMode` (`default|acceptEdits|bypassPermissions|plan|dontAsk|auto`), `canUseTool`, `hooks`, `mcpServers`, `allowedTools`/`disallowedTools`, `includePartialMessages`, `abortController`, `resume`, `settingSources`.
- `Query` exposes `interrupt()`, `supportedModels()`, `accountInfo()`, `mcpServerStatus()`, `setPermissionMode()`.
- Usage data: `SDKResultMessage.total_cost_usd/usage/modelUsage`, the `rate_limit_event` message (`status`, `resetsAt`, `utilization`), and `SDKUsageReport` (the result of `/usage`, experimental).
- Latest versions: electron 45.1.0, electron-vite 6.0.0, react 19.3.1, tailwindcss 4.3.3, monaco-editor 0.57.0, @xterm/xterm 6.0.0, node-pty 1.1.0, better-sqlite3 13.0.3, simple-git 4.0.2, @modelcontextprotocol/sdk 1.32.2, @anthropic-ai/sdk 1.3.0, openai 7.45.1, @mistralai/mistralai 3.4.0, recharts 3.10.1, vitest 5.0.5. I confirm compatibility at install time.

## Architecture

```
Renderer (React, sandboxed, contextIsolation, no Node)
   |  window.atelier.*  (typed, generated from shared/ipc contract)
Preload (contextBridge, zero logic)
   |  ipcRenderer.invoke / on   (validated with zod in main)
Main process
   ├─ ipc/        handlers, one file per domain, zod-validated
   ├─ services/   workspace, fs-watch, search, terminals, git/worktrees, secrets, db
   ├─ agents/     AgentManager -> Session -> Provider (ClaudeCode | Api)
   ├─ permissions/ PermissionEngine (pure) + approval broker (IPC round-trip)
   ├─ mcp/        McpHub (one client per server, tool registry, per-agent filter)
   └─ metrics/    usage recorder, pricing table, aggregations
```

- **IPC contract**: `src/shared/ipc/contract.ts` defines every channel as `{ request: zod, response: zod }` or as an event. Preload and main both import it, so the types have one source of truth. Streams (agent deltas, pty data, fs events) are push events with a subscription id.
- **Renderer state**: zustand stores that only mirror main state and call `window.atelier`. Components stay presentational. Business logic lives in main or in pure `shared/` modules.
- **Secrets**: `safeStorage.encryptString` produces ciphertext stored in the SQLite `secrets` table. Values are decrypted only in main, at the moment a provider needs them, and never cross IPC. A logger redaction pass masks anything that looks like a key or token.

### Provider layer
```ts
interface Provider {
  readonly kind: 'claude-code' | 'anthropic' | 'openai' | 'mistral' | 'ollama';
  testConnection(): Promise<ConnectionResult>;
  listModels(): Promise<ModelInfo[]>;
  startSession(cfg: SessionConfig): Promise<ProviderSession>;
}
interface ProviderSession {
  send(message: UserMessage): void;
  events: AsyncIterable<AgentEvent>; // text_delta, tool_call, tool_result, approval_request, usage, rate_limit, error, done
  interrupt(): Promise<void>;
  stop(): Promise<void>;
}
```
- **ClaudeCodeProvider**: calls `query()` in streaming-input mode with `env: { CLAUDE_CONFIG_DIR: profileDir, ANTHROPIC_API_KEY? }`, `cwd: worktree`, `includePartialMessages: true`, `mcpServers` (only the agent's allowed servers, from McpHub configs) and `hooks.PreToolUse` connected to the PermissionEngine. Profile dirs live at `%APPDATA%\Atelier\claude-profiles\<id>`. **Login**: the Accounts screen opens an embedded xterm that runs the Claude Code binary (bundled path resolved at runtime and verified in Phase 2, or a user-set path) with that `CLAUDE_CONFIG_DIR`. You run `/login` there. The IDE never sees the credentials.
- **ApiProvider**: one agent loop (`agents/loop.ts`) over a thin `ChatAdapter` for each vendor: Anthropic SDK, and OpenAI SDK for OpenAI, Ollama (`<baseUrl>/v1`) and Mistral. The loop streams, collects tool calls, runs them through the PermissionEngine and `ToolExecutor` (read/write file, list tree, run command, MCP tools), feeds results back, and stops on end turn, max turns or abort.

### Permissions
`PermissionEngine.decide(agent, toolCall) -> allow | deny | ask` is a pure function, unit-tested.
- **Validate everything**: reads are allowed, writes and shell commands ask.
- **Files auto / commands validated**: writes inside the worktree are allowed, shell commands ask.
- **Autonomous in worktree**: anything inside the worktree is allowed. File tools aimed outside it are denied, and so are git push and commands that leave the worktree. Limitation: a shell command cannot be fully sandboxed, and the README says so.

When the result is `ask`, the approval broker emits `approval_request` to the UI (inline card) and waits. Allow once, allow for the session, and deny with a message are the three answers.

### Persistence (SQLite, `%APPDATA%\Atelier\atelier.db`, numbered migrations)
Tables: `profiles`, `secrets`, `mcp_servers`, `agents`, `agent_mcp_tools`, `tasks` (kanban), `sessions`, `messages`, `tool_calls`, `usage_events`, `rate_limit_events`, `settings`, `pricing`.

### Worktrees
Each task gets branch `atelier/<task-slug>` and a worktree at `%LOCALAPPDATA%\Atelier\worktrees\<repo-hash>\<task-slug>`. That location is outside the repo, so file watchers and tooling don't see it. `WorktreeService` covers create, list, diff against the base, merge (no-ff, with conflicts shown), and remove plus branch delete when a task is abandoned.

## Project tree
```
atelier/ (repo root)
├─ package.json, electron.vite.config.ts, tsconfig*.json, vitest.config.ts
├─ components.json (shadcn), electron-builder.yml, README.md
├─ resources/ (icons)
└─ src/
   ├─ shared/            types, ipc/contract.ts, permissions/engine.ts, pricing.ts (pure, tested)
   ├─ main/
   │  ├─ index.ts, window.ts, logger.ts
   │  ├─ ipc/            workspace.ts, fs.ts, terminal.ts, git.ts, profiles.ts, agents.ts, mcp.ts, metrics.ts
   │  ├─ services/       db/ (migrations), secrets.ts, workspace.ts, search.ts (ripgrep via @vscode/ripgrep), pty.ts, worktrees.ts
   │  ├─ agents/         manager.ts, session.ts, providers/{claude-code,api}/, adapters/{anthropic,openai-compat}.ts, loop.ts, tools/
   │  ├─ permissions/    broker.ts
   │  ├─ mcp/            hub.ts, import-claude-desktop.ts
   │  └─ metrics/        recorder.ts, queries.ts
   ├─ preload/index.ts
   └─ renderer/
      ├─ index.html, main.tsx, App.tsx, styles/ (tailwind, themes, fonts)
      ├─ components/ui/  (shadcn)
      ├─ layout/         ActivityBar, Shell (react-resizable-panels), StatusBar
      ├─ features/       explorer, editor, terminal, agent-panel, kanban, accounts, mcp, supervision, settings, command-palette
      ├─ stores/         zustand slices
      └─ lib/            ipc client, i18n-free strings, formatting
```
Fonts are Inter and JetBrains Mono, bundled locally from @fontsource (no CDN). Theming uses Tailwind v4 CSS variables with `light` as default and `.dark`, and Monaco plus xterm themes follow the same tokens.

## Roadmap (one commit per coherent step, I stop at the end of each phase)
1. **Skeleton and IDE base**: git init, electron-vite + React + TS strict + Tailwind + shadcn, typed IPC, layout (activity bar, resizable and collapsible panels, status bar), light/dark themes, explorer (tree + watcher), Monaco tabs, file search, terminals (xterm + node-pty), SQLite + migrations, README (Windows prerequisites).
2. **Profiles, secrets, Claude Code**: Accounts screen (CRUD, color/label, test, models), safeStorage secrets, profile dirs and the embedded login terminal, ClaudeCodeProvider, agent panel chat (streaming, collapsible tool calls, inline approvals), PermissionEngine + broker, tests.
3. **API providers and MCP**: adapters (Anthropic, OpenAI, Mistral, Ollama), shared agent loop and base tools, McpHub (stdio/HTTP, status, tools), `claude_desktop_config.json` import, per-agent tool allow-list, tests.
4. **Parallel agents**: agent definitions, Kanban (To do, In progress, To review, Done), WorktreeService, read-only per-agent terminals, Monaco diff review with merge / request changes / abandon, tests.
5. **Supervision and polish**: dashboard per profile (active sessions, tokens, estimated cost, history, rate-limit info), recharts, Ctrl+K command palette, empty states, animations, error surfaces, packaging script.

## Minor points, with defaults I'll use unless you say otherwise
- Package manager: **npm**. pnpm's symlinks often cause trouble with Electron native modules.
- Pricing for cost estimates: a seeded table that can be edited in Settings. Claude Code costs come from `total_cost_usd`, which the SDK computes locally.
- Request changes: the agent resumes in the same worktree, with your review comments as the next message.
- Merge target: the branch that was checked out when the task was created. Merge is no-ff, and on conflict I abort and show the conflicting files.
- Agent CPU guard: a default cap on concurrent running agents (4), configurable.
- Packaging (NSIS installer) arrives in Phase 5. Before that, the app runs with `npm run dev`.

## Verification
- `npm run typecheck`, `npm run lint` and `npx vitest run` at every commit. Unit tests cover PermissionEngine, the providers (with mocked SDKs and HTTP), the agent loop, WorktreeService (on a temp git repo) and the config importer.
- At the end of each phase: launch with `npm run dev` and drive the real window (Electron through the run skill and screenshots) to check that phase's features, then hand it to you to test.
- Phase 1 smoke test: open this repo, edit a file in Monaco, run `git status` in a terminal, toggle the dark theme, resize and collapse the panels.
