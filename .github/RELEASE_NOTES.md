Preview of Clyde, an agent-centric desktop IDE for Windows: several AI accounts side by side, agents working in parallel on one repository, and live supervision of what they do and cost.

## Install

1. Download **Clyde-Setup-<version>.exe** below and run it. It installs for your user only (no admin rights), adds Clyde to the Start menu and the desktop, and starts it.
2. The installer is not code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.
3. In Clyde, open a folder, then add an account in **Settings › Accounts & providers**: a Claude, ChatGPT or Gemini subscription (through Claude Code's, Codex's or Antigravity's own sign-in), an Anthropic, OpenAI or Gemini API key, or a local Ollama.

### Portable version

Prefer not to install? Download **Clyde-<version>-portable.exe** instead and run it from any folder, a USB stick included. It unpacks itself (about 600 MB) at each start, so it is slow to open (37 seconds on GitHub's Windows test machine; the installed version opens in a few seconds), and it keeps its data in a `Clyde-data` folder next to the exe. API keys are encrypted for your Windows account: on another computer or account, enter them again in *Accounts*.

Install [Git for Windows](https://git-scm.com/download/win) to use the task board (each task gets its own branch and worktree).

To uninstall, use *Settings › Apps* in Windows. Your accounts and history stay in `%APPDATA%\Clyde`; delete that folder to remove them too.

## New in this version

- **Providers**: Codex CLI (ChatGPT subscription), Antigravity CLI (Gemini subscription) and the Gemini API. Mistral is no longer supported: updating removes Mistral accounts and says so once.
- **Usage limits**: 5-hour and weekly gauges per subscription account and per session, each marked official, estimated or unavailable; alerts and a 7-day history.
- **Settings**: one searchable page, French translation, configuration export without secrets.
- **Motion**: animations across the interface (*Full*, *Reduced* or *Off*); drag and drop on the task board.
- **Chat**: plain conversations next to the agents, with Markdown, math, code, attachments and *Continue in the project*.
- **Dictation**: local transcription with whisper.cpp, downloaded on demand from Settings › Voice, or an OpenAI or Gemini account.
- **MCP catalog**: checked servers (Filesystem, Git, Fetch, GitHub, Playwright, Context7, Docker) with their context cost.
- **Memory & context**: one memory shared by every agent (CLAUDE.md, AGENTS.md, GEMINI.md), proposals reviewed as a diff, prompt caching, shorter tool results, rolling summaries, *Compact* and *New session with summary*, and where the tokens go in Supervision.

Clyde 0.2 keeps the data of 0.1 (`%APPDATA%\Clyde`) and migrates it.

## What's in it

- Editor (Monaco), file explorer, search, integrated terminals
- Accounts: Claude Code, Codex and Antigravity (subscriptions), Anthropic, OpenAI and Gemini API keys, Ollama; each with its color and label; keys encrypted with Windows DPAPI
- Chat, voice dictation, and a memory shared by every agent
- Agent sessions with three permission levels, and approval cards for file changes and commands
- MCP servers (local or remote, or from the catalog), with tools allowed per agent; import from Claude Desktop
- Task board: agents work in their own git worktrees, then you review the diff, request changes, merge or abandon
- Supervision: sessions, tokens, cost, prompt cache and usage limits per account, with full transcripts
- Command palette (Ctrl+K) and quick file open (Ctrl+P)

## Known limits

This is a preview: expect rough edges, and keep your work committed. Closing Clyde ends running agent sessions (their history stays in Supervision). Antigravity has no *Compact* button (its `/compact` is not documented), and the downloaded whisper.cpp runs on the CPU. See the [README](https://github.com/ferreroantoine/clyde#known-limits) for the full list.
