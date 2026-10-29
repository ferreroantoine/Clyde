First preview of Clyde, an agent-centric desktop IDE for Windows: several AI accounts side by side, agents working in parallel on one repository, and live supervision of what they do and cost.

## Install

1. Download **Clyde-Setup-<version>.exe** below and run it. It installs for your user only (no admin rights), adds Clyde to the Start menu and the desktop, and starts it.
2. The installer is not code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.
3. In Clyde, open a folder, then add an account in **Accounts**: a Claude subscription (through Claude Code's own sign-in), an Anthropic, OpenAI or Mistral API key, or a local Ollama.

Install [Git for Windows](https://git-scm.com/download/win) to use the task board (each task gets its own branch and worktree).

To uninstall, use *Settings › Apps* in Windows. Your accounts and history stay in `%APPDATA%\Clyde`; delete that folder to remove them too.

## What's in it

- Editor (Monaco), file explorer, search, integrated terminals
- Accounts: Claude Code (subscription or API key), Anthropic, OpenAI, Mistral, Ollama, each with its color and label; keys encrypted with Windows DPAPI
- Agent chat with three permission levels, and approval cards for file changes and commands
- MCP servers (local or remote), with tools allowed per agent; import from Claude Desktop
- Task board: agents work in their own git worktrees, then you review the diff, request changes, merge or abandon
- Supervision: sessions, tokens, cost and usage limits per account, with full transcripts
- Command palette (Ctrl+K) and quick file open (Ctrl+P)

## Known limits

This is a preview: expect rough edges, and keep your work committed. Closing Clyde ends running agent sessions (their history stays in Supervision). See the [README](https://github.com/ferreroantoine/clyde#known-limits) for the full list.
