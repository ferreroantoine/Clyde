import { z } from 'zod'
import { tk } from './i18n'
import type { McpServerInput } from './mcp'

/**
 * Ready-made MCP servers. Each was checked against its registry and its own `--help` or
 * tools/list (October 2026); `tools` and `toolChars` are what tools/list returned then, to show
 * the context cost before anything is installed. Nothing here is installed or enabled by default.
 *
 * Not offered: SQLite. The reference server (mcp-server-sqlite) was archived; its last release
 * is from April 2025 and nothing maintained replaces it.
 */

export const presetParamSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(40),
  label: z.string().max(80),
  hint: z.string().max(300).default(''),
  /** `folder` and `file` get a picker; `secret` is stored encrypted and never shown again. */
  kind: z.enum(['folder', 'file', 'text', 'secret']),
  required: z.boolean(),
  /** `workspace`: the open project's folder. */
  defaultValue: z.enum(['workspace']).optional(),
  /** Where the value goes: a `{key}` placeholder in the arguments, an environment variable or a header. */
  target: z.discriminatedUnion('type', [
    z.object({ type: z.literal('arg') }),
    z.object({ type: z.literal('env'), name: z.string().max(200) }),
    z.object({ type: z.literal('header'), name: z.string().max(200), prefix: z.string().max(40).default('') })
  ])
})
export type PresetParam = z.output<typeof presetParamSchema>

export interface McpPreset {
  id: string
  /** Server name once installed; also the base of its slug (`mcp__<slug>__tool`). */
  name: string
  title: string
  description: string
  publisher: string
  source: string
  transport: 'stdio' | 'http'
  command: string
  /** May hold `{key}` placeholders filled from the parameters. */
  args: string[]
  url: string
  params: PresetParam[]
  /** Tool names, as listed when the preset was checked; empty when unknown before a test. */
  tools: string[]
  /** Size of the tool definitions (name, description, input schema) in JSON characters. */
  toolChars: number
  /** What must be installed for it to start. */
  requires: string
  builtin: boolean
}

const workspaceFolder = (label: string, hint: string): PresetParam => ({
  key: 'folder',
  label,
  hint,
  kind: 'folder',
  required: true,
  defaultValue: 'workspace',
  target: { type: 'arg' }
})

export const BUILTIN_PRESETS: McpPreset[] = [
  {
    id: 'filesystem',
    name: 'filesystem',
    title: tk('Filesystem'),
    description: tk('Read, write, move and search files in the folders you allow, the open project by default.'),
    publisher: 'Model Context Protocol (reference server)',
    source: 'https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '{folder}'],
    url: '',
    params: [workspaceFolder(tk('Allowed folder'), tk('The server refuses anything outside it.'))],
    tools: ['read_file', 'read_text_file', 'read_media_file', 'read_multiple_files', 'write_file', 'edit_file', 'create_directory', 'list_directory', 'list_directory_with_sizes', 'directory_tree', 'move_file', 'search_files', 'get_file_info', 'list_allowed_directories'],
    toolChars: 8_042,
    requires: tk('Node.js (npx); version 2.1 asks for Node 24 but runs on 22'),
    builtin: true
  },
  {
    id: 'git',
    name: 'git',
    title: tk('Git'),
    description: tk('History, diffs, branches, staging and commits of a repository.'),
    publisher: 'Model Context Protocol (reference server)',
    source: 'https://pypi.org/project/mcp-server-git/',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '{folder}'],
    url: '',
    params: [workspaceFolder(tk('Repository'), tk('The git repository the tools work on.'))],
    tools: ['git_status', 'git_diff_unstaged', 'git_diff_staged', 'git_diff', 'git_commit', 'git_add', 'git_reset', 'git_log', 'git_create_branch', 'git_checkout', 'git_show', 'git_branch'],
    toolChars: 4_941,
    requires: tk('uv (uvx), from astral.sh/uv'),
    builtin: true
  },
  {
    id: 'fetch',
    name: 'fetch',
    title: tk('Fetch'),
    description: tk('Reads a web page and returns it as Markdown. Private and local addresses are refused.'),
    publisher: 'Model Context Protocol (reference server)',
    source: 'https://pypi.org/project/mcp-server-fetch/',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    url: '',
    params: [],
    tools: ['fetch'],
    toolChars: 1_045,
    requires: tk('uv (uvx), from astral.sh/uv'),
    builtin: true
  },
  {
    id: 'github',
    name: 'github',
    title: tk('GitHub'),
    description: tk('Issues, pull requests, repositories, code search and Actions, through GitHub’s hosted server.'),
    publisher: 'GitHub (github/github-mcp-server)',
    source: 'https://github.com/github/github-mcp-server',
    transport: 'http',
    command: '',
    args: [],
    url: 'https://api.githubcopilot.com/mcp/',
    params: [
      {
        key: 'token',
        label: tk('Personal access token'),
        hint: tk('A fine-grained token with the repositories and permissions the agents may use. Stored encrypted.'),
        kind: 'secret',
        required: true,
        target: { type: 'header', name: 'Authorization', prefix: 'Bearer ' }
      }
    ],
    tools: [],
    toolChars: 0,
    requires: tk('A GitHub account and a token'),
    builtin: true
  },
  {
    id: 'playwright',
    name: 'playwright',
    title: tk('Playwright'),
    description: tk('Drives a browser to test a web interface: navigate, click, type, take snapshots and screenshots.'),
    publisher: 'Microsoft (@playwright/mcp)',
    source: 'https://www.npmjs.com/package/@playwright/mcp',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    url: '',
    params: [],
    tools: ['browser_close', 'browser_resize', 'browser_console_messages', 'browser_handle_dialog', 'browser_emulate_media', 'browser_evaluate', 'browser_file_upload', 'browser_drop', 'browser_find', 'browser_fill_form', 'browser_press_key', 'browser_type', 'browser_navigate', 'browser_navigate_back', 'browser_network_requests', 'browser_network_request', 'browser_run_code_unsafe', 'browser_take_screenshot', 'browser_snapshot', 'browser_click', 'browser_drag', 'browser_hover', 'browser_select_option', 'browser_tabs', 'browser_wait_for'],
    toolChars: 17_565,
    requires: tk('Node.js (npx); downloads a browser on first use'),
    builtin: true
  },
  {
    id: 'context7',
    name: 'context7',
    title: tk('Context7'),
    description: tk('Up-to-date documentation and code examples of libraries and frameworks.'),
    publisher: 'Upstash (@upstash/context7-mcp)',
    source: 'https://www.npmjs.com/package/@upstash/context7-mcp',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    url: '',
    params: [
      {
        key: 'apiKey',
        label: tk('API key (optional)'),
        hint: tk('Raises the rate limits; get one on context7.com. Stored encrypted.'),
        kind: 'secret',
        required: false,
        target: { type: 'env', name: 'CONTEXT7_API_KEY' }
      }
    ],
    tools: ['resolve-library-id', 'query-docs'],
    toolChars: 4_940,
    requires: tk('Node.js (npx)'),
    builtin: true
  },
  {
    id: 'docker',
    name: 'docker',
    title: tk('Docker'),
    description: tk('Lists and manages local containers, images, networks and volumes. Docker is not a sandbox: review what the agent creates.'),
    publisher: 'ckreiling/mcp-server-docker (community; Docker publishes no container-management server)',
    source: 'https://pypi.org/project/mcp-server-docker/',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-docker'],
    url: '',
    params: [],
    tools: ['list_containers', 'create_container', 'run_container', 'recreate_container', 'start_container', 'fetch_container_logs', 'stop_container', 'remove_container', 'list_images', 'pull_image', 'push_image', 'build_image', 'remove_image', 'list_networks', 'create_network', 'remove_network', 'list_volumes', 'create_volume', 'remove_volume'],
    toolChars: 0,
    requires: tk('uv (uvx) and a running Docker'),
    builtin: true
  }
]

/** Rough token count of tool definitions: about four JSON characters per token. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/** Above this, an agent's tool definitions alone take a noticeable share of every request. */
export const TOOL_TOKENS_WARNING = 15_000
export const TOOL_COUNT_WARNING = 40

/** The server a preset becomes with the user's values: placeholders filled, secrets in env or headers. */
export function presetToInput(preset: McpPreset, values: Record<string, string>): McpServerInput {
  const value = (p: PresetParam) => (values[p.key] ?? '').trim()
  const missing = preset.params.filter((p) => p.required && !value(p))
  if (missing.length) throw new Error(missing.map((p) => p.label).join(', '))
  const env: Record<string, string> = {}
  const headers: Record<string, string> = {}
  for (const p of preset.params) {
    const v = value(p)
    if (!v) continue
    if (p.target.type === 'env') env[p.target.name] = v
    if (p.target.type === 'header') headers[p.target.name] = `${p.target.prefix}${v}`
  }
  const fill = (arg: string) => arg.replace(/\{(\w+)\}/g, (_, key: string) => (values[key] ?? '').trim())
  return preset.transport === 'stdio'
    ? { transport: 'stdio', name: preset.name, command: preset.command, args: preset.args.map(fill).filter((a) => a !== ''), env, enabled: true }
    : { transport: 'http', name: preset.name, url: preset.url, headers, enabled: true }
}

/** A preset saved by the user from one of their servers. */
export const userPresetInputSchema = z.object({
  serverId: z.uuid(),
  title: z.string().trim().min(1, tk('Name is required')).max(60),
  description: z.string().trim().max(500).default('')
})
export type UserPresetInput = z.input<typeof userPresetInputSchema>

export const presetInstallSchema = z.object({
  presetId: z.string().min(1).max(64),
  values: z.record(z.string().max(40), z.string().max(10_000)).default({})
})

/** What a test run found: the tools and their definition size, or why it did not start. */
export interface McpProbe {
  ok: boolean
  error: string | null
  tools: Array<{ name: string; description: string; chars: number }>
}
