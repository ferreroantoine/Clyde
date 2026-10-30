Pre-release of Atelier for Windows (x64). The installer is not code-signed: Windows SmartScreen warns on first run (*More info* › *Run anyway*).

This is a personal build: subscription accounts (Claude Code, Codex, Antigravity) are available and marked "Personal use".

## What's new in 0.2

- **Providers**: Codex CLI (ChatGPT subscription), Antigravity CLI (Gemini subscription) and the Gemini API join Claude Code, Anthropic, OpenAI and Ollama. Mistral is no longer supported.
- **Usage limits**: 5-hour and weekly gauges per subscription account and per session, each marked official, estimated or unavailable; alerts and a 7-day history.
- **Settings**: one searchable page, French translation, configuration export without secrets.
- **Motion**: animations across the interface, with *Full*, *Reduced* and *Off*; the Kanban board supports drag and drop.
- **Chat**: plain conversations with Markdown, math, code, attachments and *Continue in the project*.
- **Dictation**: local transcription with whisper.cpp (downloaded on demand), or an OpenAI or Gemini account.
- **MCP catalog**: checked servers (Filesystem, Git, Fetch, GitHub, Playwright, Context7, Docker) with their context cost.
- **Memory & context**: a memory shared by every agent (CLAUDE.md, AGENTS.md, GEMINI.md), proposals reviewed as a diff, prompt caching, shorter tool results, rolling summaries, *Compact* and *New session with summary*, and where the tokens go in Supervision.

## Known limits

- Antigravity: no *Compact* button (its `/compact` is not documented).
- whisper.cpp: the downloaded build runs on the CPU; for Vulkan or CUDA, point Settings › Voice to your own build.
- See the README for the full list.
