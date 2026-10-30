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

- **Model and reasoning effort**: one model picker in the agent panel, the chat and saved agents. It lists the account's models with a search, and also takes any model id you type. When the model supports it, you can set its reasoning effort (low, medium, high, and more on Claude, Codex and Antigravity). The agent panel header shows the effort a session uses.
- **Dictation**: while it listens, *Enter* stops and inserts the text (without sending it), *Escape* cancels.
- **Explorer**: the selected file follows the editor tab. Closing a tab goes back to the one you viewed before it, and with no file open nothing is selected.
- **Selectable text**: messages in the agent panel, the chat and the Supervision transcripts can be selected and copied.

Earlier in 0.2: Codex and Antigravity CLIs and the Gemini API; usage limits; one settings page in English or French; animations; Chat; local dictation; the MCP catalog; a shared memory and context savings.

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
