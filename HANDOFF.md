# Handoff: moving Atelier to a new environment

Working note for whoever (human or agent) picks the project up in the new environment. The first environment was a Windows 11 workstation with SentinelOne and FortiClient, and it got in the way. The project itself is documented in [README.md](README.md), [docs/SPEC.md](docs/SPEC.md) (original spec, in French) and [docs/PLAN.md](docs/PLAN.md) (approved plan).

## Where things stand

- **Phase 1 is implemented and committed**: Electron skeleton, typed IPC, resizable layout, light/dark themes, explorer, Monaco tabs, ripgrep search, xterm + node-pty terminals, SQLite with migrations, README.
- On the old machine, typecheck, lint, 24 unit tests and the build all passed. The built app was driven with `scripts/drive.mjs` (Playwright): open a workspace, open and edit a file, search, terminal running `git status`, theme switch, panel collapse, persistence across restarts. Dev mode (`npm run dev`) was also checked: HMR connects and there are no CSP errors.
- **The project owner has not tested Phase 1 yet.** The workflow rule is to stop at the end of each phase for their test and wait for their go-ahead before the next phase.

## What could not be done because of SentinelOne

SentinelOne is suspected, not proven. Windows Defender reported no detections, and SentinelOne's console was not accessible to check.

1. **Files silently deleted from the project.** `eslint.config.js` disappeared three times and had to be restored with `git checkout`. Files inside `node_modules` also vanished after successful installs: `picomatch/index.js` and `picomatch/lib/*`, part of `@vitest/mocker`, `electron-vite/bin/electron-vite.js`, and `eslint/bin/eslint.js` (the whole `bin/` folder emptied minutes after a clean `npm ci`). Each time this forced a full `rm -rf node_modules && npm ci`. Because of this, no state on that machine could be trusted between two sessions.
2. **Sessions interrupted** twice while waiting on long-running commands (the dev server). The cause was not established; it may or may not be the EDR.
3. **Not verified because of the above**: a stable `node_modules` over several sessions, and a lint run immediately after a clean clone without having to restore a file.

Not caused by SentinelOne, but also blocked on that machine:

4. **No C++ build tools** (VS 2022 Build Tools, Python 3). Installing them needs admin rights. So a plain `npm install` was never verified: it fails on `node-gyp rebuild` for better-sqlite3, even though the app only uses the prebuilt N-API binary. `npm run install:prebuilt` was used instead.
5. **Not tested**: `npm run preview` and packaging (packaging is planned for Phase 5 anyway).

## To do in the new environment

1. Clone, then install: `npm install` if build tools are present, otherwise `npm run install:prebuilt`. Both end with `install-electron`.
2. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Expect 24 passing tests.
3. Check that no files go missing: `git status` must stay clean after install, build and test runs.
4. Run the app (`npm run dev`) and redo the Phase 1 smoke test: open a folder, edit and save a file, search, run `git status` in the terminal, switch themes, resize and collapse panels, restart and check that the workspace and theme come back. On a headless Linux machine, `scripts/drive.mjs` needs xvfb (`xvfb-run -a node scripts/drive.mjs <outDir> '<steps>'`) and Electron's Linux dependencies.
5. If the target is Linux or macOS, check the parts that are Windows-specific: shell detection in `src/main/services/pty.ts` (pwsh / Windows PowerShell, `$SHELL` elsewhere), the README install section, and paths described with `%APPDATA%`.
6. Update the README "Status" table if anything changes, then hand Phase 1 to the project owner for testing.
7. Once they approve, start **Phase 2** as described in docs/PLAN.md: account profiles (CRUD, color and label, connection test, model list), secrets encrypted with `safeStorage`, one `CLAUDE_CONFIG_DIR` per Claude profile with login through an embedded terminal running Claude Code's `/login`, `ClaudeCodeProvider` on `@anthropic-ai/claude-agent-sdk` with a `PreToolUse` hook connected to the permission engine, the agent chat panel (streaming, collapsible tool calls, inline approvals), and unit tests for the provider layer and permissions. Check the Agent SDK documentation before relying on any option; do not assume.

## Decisions to keep in mind

- Claude subscription profiles are allowed but labeled "personal use", and disabled in a distribution build (`ATELIER_DISTRIBUTION=1`). The Agent SDK docs forbid third-party products from offering claude.ai login unless Anthropic has approved them.
- UI and README in English.
- Claude Code agents load all setting sources (user, project, local). The IDE enforces permissions with a programmatic `PreToolUse` hook, because allow rules in the user's settings would skip `canUseTool`.
- One commit per coherent step, and a stop at the end of each phase.

---

**Delete this file (`HANDOFF.md`) once everything above is done**, that is, once Phase 1 has been verified in the new environment and handed to the project owner. Commit the deletion.
