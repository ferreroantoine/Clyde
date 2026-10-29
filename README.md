# Atelier

Agent-centric desktop IDE for Windows: several AI accounts and providers side by side, several agents on one repository, live supervision, and MCP tools allowed per agent.

Stack: Electron 45, React 19, TypeScript (strict), electron-vite, Tailwind CSS v4 + shadcn/ui, Monaco, xterm.js + node-pty, SQLite (better-sqlite3).

Docs: [original spec](docs/SPEC.md) (French), [approved plan](docs/PLAN.md).

## Status

| Phase | Content | State |
| --- | --- | --- |
| 1 | Electron skeleton, layout, themes, explorer, Monaco, terminal, SQLite | done |
| 2 | Account profiles, encrypted secrets, Claude Code provider, agent chat, permissions | next |
| 3 | API providers (Anthropic, OpenAI, Mistral, Ollama), in-house agent loop, MCP | |
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

## Architecture

```
Renderer (React, sandboxed, no Node access)
   |  window.atelier.invoke / on   (allow-listed channels only)
Preload (contextBridge, no logic)
   |  ipcRenderer
Main process
   ipc/       one file per domain; every request is validated with zod
   services/  workspace, files, watcher, search (ripgrep), pty, settings, db
```

- `src/shared/ipc/contract.ts` is the single definition of every channel: request schema, response type and event payloads. Main and renderer are both typed from it.
- Every response is a `{ ok, data | error }` envelope with a stable error code, so failures reach the UI as readable messages instead of generic IPC rejections.
- File access goes through `resolveInside`, which refuses any path outside the open workspace.
- Logs (`%APPDATA%\Atelier\logs\main.log`) go through a redaction pass that masks API keys and tokens.
- Data lives in `%APPDATA%\Atelier\atelier.db` (SQLite, WAL). Migrations are append-only in `src/main/services/db/migrations.ts` and tracked with `PRAGMA user_version`.
- Renderer state lives in zustand stores; components stay presentational.

```
src/
  shared/     IPC contract, types, settings schema, redaction (pure, tested)
  main/       entry, window, logger, ipc/, services/
  preload/    window.atelier bridge
  renderer/   layout/, features/ (explorer, editor, search, terminal, agent-panel, settings),
              stores/, lib/ (ipc client, monaco, terminal registry, theme), components/ui (shadcn)
```

## Notes on Claude accounts (Phase 2)

Each Claude profile will get its own Claude Code configuration directory (`CLAUDE_CONFIG_DIR`), and you sign in through Claude Code's own `/login` flow. The IDE never reads the credentials. The Agent SDK documentation states that third-party products may not offer claude.ai login unless Anthropic has approved them. Subscription profiles are therefore marked "personal use", and a distribution build (`ATELIER_DISTRIBUTION=1`) will only allow API-key profiles.

## Troubleshooting

- **`gyp ERR! find Python` during `npm install`**: install the build tools above, or use `npm run install:prebuilt`.
- **`Error: Electron uninstall` from `npm run dev`**: the Electron binary was not downloaded; run `npx install-electron`.
- **Files vanishing from the project or `node_modules`** (for example `Cannot find package ...` right after a working install): an endpoint security agent may be quarantining JavaScript files. Check its console and ask for an exclusion on the project folder, then reinstall with `npm ci`.
- **Blank window after `npm run dev`**: check the terminal running electron-vite for build errors, then `%APPDATA%\Atelier\logs\main.log`.
- **"Atelier could not open its database"**: the dialog shows the file path. Close other Atelier windows, or move the file aside to start fresh. Settings are kept in memory for that session.
