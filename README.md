# Atelier

Agent-centric desktop IDE for Windows: several AI accounts and providers side by side, several agents on one repository, live supervision, and MCP tools allowed per agent.

Stack: Electron 45, React 19, TypeScript (strict), electron-vite, Tailwind CSS v4 + shadcn/ui, Monaco, xterm.js + node-pty, SQLite (better-sqlite3).

Docs: [original spec](docs/SPEC.md) (French), [approved plan](docs/PLAN.md).

## Status

| Phase | Content | State |
| --- | --- | --- |
| 1 | Electron skeleton, layout, themes, explorer, Monaco, terminal, SQLite | done |
| 2 | Account profiles, encrypted secrets, Claude Code provider, agent chat, permissions | done |
| 3 | API providers (Anthropic, OpenAI, Mistral, Ollama), in-house agent loop, MCP | next |
| 4 | Parallel agents, git worktrees, Kanban, diff review and merge | |
| 5 | Supervision dashboard, metrics, command palette, polish | |

## Install on Windows

### Prerequisites

- **Node.js 22.12 or later** (developed on Node 24) and npm
- **Git for Windows**
- **C++ build tools**, only needed for a plain `npm install`:
  - Visual Studio 2022 Build Tools with the *Desktop development with C++* workload and the *MSVC Spectre-mitigated libs* component
  - Python 3

  From an elevated PowerShell:

  ```powershell
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --add Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre"
  winget install Python.Python.3.12
  ```

Why the build tools: `node-pty` and `better-sqlite3` ship N-API prebuilt binaries for Windows x64/arm64 that load in Electron without recompiling. But npm still runs `node-gyp rebuild` for `better-sqlite3` during install, and that step needs a compiler and Python. If you cannot install them, use the prebuilt-only install below. The app uses the prebuilt binaries either way.

### Install and run

```powershell
git clone <repo> atelier
cd atelier
npm install            # or, without build tools: npm run install:prebuilt
npm run dev
```

Both install commands end by downloading the Electron binary (`install-electron`), which electron-vite needs before `npm run dev`.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the app with hot reload |
| `npm run build` | Builds main, preload and renderer into `out/` |
| `npm run preview` | Runs the built app |
| `npm run typecheck` | TypeScript, strict, for both main and renderer |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run install:prebuilt` | `npm install --ignore-scripts` then `install-electron`, for machines without C++ build tools |
| `npm run drive -- <outDir> '<steps json>'` | Launches the built app with Playwright, runs steps and takes screenshots (see `scripts/drive.mjs`) |

## Using it

- **Open a folder**: the button in the explorer or `Ctrl+O`. Atelier reopens the last workspace at startup.
- **Keyboard**: `Ctrl+B` sidebar, `Ctrl+J` or `` Ctrl+` `` terminal, `Ctrl+Alt+B` agent panel, `Ctrl+Shift+E` files, `Ctrl+Shift+F` search, `Ctrl+S` save, `Ctrl+,` settings.
- **Terminal**: pwsh when installed, otherwise Windows PowerShell; another shell can be set in Settings. `Ctrl+C` copies when text is selected (otherwise it interrupts) and `Ctrl+V` pastes, as in Windows Terminal.
- **Editor**: if a file changes on disk while you have unsaved edits, a banner lets you load the disk version or keep yours.
- **Accounts** (key icon in the activity bar): add a Claude subscription or an Anthropic API key, each with a name, a short label and a color. A subscription account opens a terminal running Claude Code's own `claude auth login`; the browser does the rest. **Test connection** checks the sign-in (and the key against the API) and lists the models, without sending a prompt.
- **Agents** (right panel): pick an account, an optional model and a permission level, then chat. Tool calls appear as collapsible cards; anything that needs your approval shows inline with *Allow once*, *Allow for the session* (the exact command, for shell tools) and *Deny*, where you can tell the agent what to do instead. Up to 4 agents run at once.

### Permission levels

| Level | Reads in the folder | File edits in the folder | Shell commands | Anything outside the folder |
| --- | --- | --- | --- | --- |
| Validate everything | run | ask | ask | ask |
| Files auto, commands validated | run | run | ask | ask |
| Autonomous in its folder | run | run | run, except `git push` and `cd` out of the folder | refused |

MCP tools and tools Atelier does not know ask first, except MCP tools in autonomous mode. The checks run in a `PreToolUse` hook, which Claude Code calls before its own allow rules, so allow rules in your Claude settings cannot skip them. A shell command cannot be fully sandboxed this way: in autonomous mode, a command can still write outside the folder through absolute paths or scripts. Use the other levels when that matters.

## Architecture

```
Renderer (React, sandboxed, no Node access)
   |  window.atelier.invoke / on   (allow-listed channels only)
Preload (contextBridge, no logic)
   |  ipcRenderer
Main process
   ipc/         one file per domain; every request is validated with zod
   services/    workspace, files, watcher, search (ripgrep), pty, settings, db, secrets, profiles
   agents/      AgentManager, claude-code/ (provider, runtime, message translator)
   permissions/ engine (pure allow/ask/deny) and approval broker
```

- `src/shared/ipc/contract.ts` is the single definition of every channel: request schema, response type and event payloads. Main and renderer are both typed from it.
- Every response is a `{ ok, data | error }` envelope with a stable error code, so failures reach the UI as readable messages instead of generic IPC rejections.
- File access goes through `resolveInside`, which refuses any path outside the open workspace.
- Logs (`%APPDATA%\Atelier\logs\main.log`) go through a redaction pass that masks API keys and tokens.
- Data lives in `%APPDATA%\Atelier\atelier.db` (SQLite, WAL). Migrations are append-only in `src/main/services/db/migrations.ts` and tracked with `PRAGMA user_version`.
- API keys are encrypted with Electron `safeStorage` (DPAPI on Windows) and stored as ciphertext. They are decrypted in main only when Claude Code starts and never cross IPC. On Linux without a keyring, Atelier refuses to store a key rather than keep it in clear.
- Each account has its own Claude Code folder, `%APPDATA%\Atelier\claude-profiles\<id>`, used as `CLAUDE_CONFIG_DIR`. Deleting the account deletes the folder. Claude Code processes get the app's environment minus every `ANTHROPIC_*` and `CLAUDE*` variable, so an account cannot pick up another one's key or token.
- Claude Code is the binary bundled with `@anthropic-ai/claude-agent-sdk`, or the path set in Settings. Sessions load your user, project and local Claude Code settings, like `claude` does.
- Renderer state lives in zustand stores; components stay presentational.

```
src/
  shared/     IPC contract, types, settings schema, profiles and agent events, redaction (pure, tested)
  main/       entry, window, logger, ipc/, services/, agents/, permissions/
  preload/    window.atelier bridge
  renderer/   layout/, features/ (explorer, editor, search, terminal, accounts, agent-panel, settings),
              stores/, lib/ (ipc client, monaco, terminal registry, theme, transcript reducer), components/ui (shadcn)
```

## Claude accounts and distribution builds

You sign in to a subscription account through Claude Code's own login, and the IDE never reads the credentials. The Agent SDK documentation states that third-party products may not offer claude.ai login unless Anthropic has approved them. Subscription accounts are therefore marked "Personal use", and a distribution build (`npm run build` with `ATELIER_DISTRIBUTION=1` set, `$env:ATELIER_DISTRIBUTION=1` in PowerShell) only allows API key accounts. Subscription accounts created by a personal build show as disabled there.

## Known limits (Phase 2)

- Conversations are not saved yet: closing Atelier ends its agent sessions. History and supervision come in Phase 5.
- Claude's `AskUserQuestion` tool is turned off until the panel can answer it; the agent asks in plain text instead.
- Agents work in the open folder. Separate worktrees per agent come in Phase 4.
