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

- **Runs in the tray**: closing the window hides Clyde to the system tray and agents keep working; quitting while they do asks first. Sessions cut by a shutdown are listed as interrupted in the agent panel and can be resumed under the same id (optionally at startup).
- **Usage limits**: when an account hits its limit, the session shows when it resets and offers to switch to a fallback account, wait and resume, or do nothing. *Settings › Agents* sets the default and the ordered fallback accounts. Any session can also be moved by hand to another account, model or effort without losing its conversation.
- **Agent panel**: see the agent's reasoning, the screenshots and images its tools return (as thumbnails with a viewer), and tool cards that read as sentences with diffs, commands and to-do checklists.
- **Questions from agents**: multiple-choice questions show as a clickable card (single or multiple choice, "Other…", Skip) in Claude Code and API agent sessions.
- **Explorer menu**: right-click for open, @mention in the agent session, explain, create a task, new file or folder, rename in place (F2), duplicate, Recycle Bin (Del), copy paths, show in File Explorer, open a terminal there. Files dragged onto the agent composer become @mentions.

Earlier in 0.2: the model picker with reasoning effort, dictation shortcuts; Codex and Antigravity CLIs and the Gemini API; usage limits; one settings page in English or French; animations; Chat; local dictation; the MCP catalog; a shared memory and context savings.

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
