import { z } from 'zod'
import { t, tk } from './i18n'

/**
 * CLI kinds drive a vendor's coding CLI, signed in with its own login: Claude Code (Agent SDK),
 * Codex (`codex app-server`) and Antigravity (`agy` headless). API kinds run Clyde's own
 * agent loop against a vendor API.
 */
export const PROFILE_KINDS = ['claude-code', 'anthropic', 'codex', 'openai', 'antigravity', 'gemini', 'ollama'] as const
export type ProfileKind = (typeof PROFILE_KINDS)[number]

export const CLI_KINDS = ['claude-code', 'codex', 'antigravity'] as const
export type CliProfileKind = (typeof CLI_KINDS)[number]
export type ApiProfileKind = Exclude<ProfileKind, CliProfileKind>

export const PROFILE_KIND_LABELS: Record<ProfileKind, string> = {
  'claude-code': 'Claude Code',
  anthropic: 'Anthropic API',
  codex: 'Codex CLI',
  openai: 'OpenAI API',
  antigravity: 'Antigravity CLI',
  gemini: 'Gemini API',
  ollama: 'Ollama'
}

/** Vendors as the UI groups them, each with its CLI and its API. */
export const PROVIDER_FAMILIES = [
  { id: 'claude', label: 'Claude', kinds: ['claude-code', 'anthropic'] },
  { id: 'chatgpt', label: 'ChatGPT', kinds: ['codex', 'openai'] },
  { id: 'gemini', label: 'Gemini', kinds: ['antigravity', 'gemini'] },
  { id: 'local', label: tk('Local'), kinds: ['ollama'] }
] as const satisfies ReadonlyArray<{ id: string; label: string; kinds: readonly ProfileKind[] }>

/** Label for a kind found in the history, including kinds this build no longer supports. */
export function kindLabel(kind: string): string {
  if (kind in PROFILE_KIND_LABELS) return PROFILE_KIND_LABELS[kind as ProfileKind]
  if (kind === 'mistral') return t('Mistral (removed)')
  return kind
}

export function isCliKind(kind: ProfileKind): kind is CliProfileKind {
  return (CLI_KINDS as readonly ProfileKind[]).includes(kind)
}

export function isApiKind(kind: ProfileKind): kind is ApiProfileKind {
  return !isCliKind(kind)
}

/**
 * How a profile signs in. A subscription uses the CLI's own login flow inside the profile's
 * config dir (Clyde never sees the credentials); an API key is stored encrypted; a local
 * Ollama needs nothing.
 */
export const AUTH_MODES = ['subscription', 'api-key', 'none'] as const
export type AuthMode = (typeof AUTH_MODES)[number]

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

/** The auth modes each kind accepts, the first being the default. */
export const KIND_AUTH: Record<ProfileKind, readonly AuthMode[]> = {
  'claude-code': ['subscription', 'api-key'],
  anthropic: ['api-key'],
  codex: ['subscription'],
  openai: ['api-key'],
  antigravity: ['subscription'],
  gemini: ['api-key'],
  ollama: ['none']
}

/**
 * Antigravity keeps its sign-in in the OS keyring, one per Windows user, so two Antigravity
 * profiles would share an account. Clyde allows one.
 */
export const SINGLE_PROFILE_KINDS: readonly ProfileKind[] = ['antigravity']

/** Profile colors, picked to stay readable as dots and badges in both themes. */
export const PROFILE_COLORS = [
  '#6366f1',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#64748b'
] as const

export const profileIdSchema = z.uuid()

const name = z.string().trim().min(1, tk('Name is required')).max(60)
const label = z.string().trim().max(12)
const color = z.enum(PROFILE_COLORS)
const model = z.string().trim().max(200)
const baseUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), tk('Enter an http:// or https:// URL'))

export const profileCreateSchema = z.object({
  kind: z.enum(PROFILE_KINDS).default('claude-code'),
  name,
  label: label.default(''),
  color,
  auth: z.enum(AUTH_MODES),
  defaultModel: model.default(''),
  /** Only for Ollama. */
  baseUrl: baseUrl.default(''),
  /** Only for `api-key` profiles. Never stored in clear and never sent back to the renderer. */
  apiKey: z.string().trim().min(1).max(500).optional()
})

export const profileUpdateSchema = z.object({
  id: profileIdSchema,
  name: name.optional(),
  label: label.optional(),
  color: color.optional(),
  defaultModel: model.optional(),
  baseUrl: baseUrl.optional(),
  /** Replaces the stored key. */
  apiKey: z.string().trim().min(1).max(500).optional()
})

export type ProfileCreate = z.input<typeof profileCreateSchema>
export type ProfileUpdate = z.input<typeof profileUpdateSchema>

/** What the renderer sees of a profile. Secrets are reduced to `hasApiKey`. */
export interface Profile {
  id: string
  kind: ProfileKind
  name: string
  label: string
  color: string
  auth: AuthMode
  defaultModel: string
  /** Server URL, for Ollama. */
  baseUrl: string
  hasApiKey: boolean
  /** Subscription logins are for personal use only (see README). */
  personalUse: boolean
  /** False when this build does not allow the profile (subscription profiles in a distribution build). */
  usable: boolean
  createdAt: number
  updatedAt: number
}

export interface ModelOption {
  value: string
  displayName: string
  description: string
}

export interface ConnectionResult {
  ok: boolean
  /** Short status for the profile card, e.g. "Signed in" or "Not signed in". */
  status: string
  detail: string | null
  email: string | null
  organization: string | null
  subscriptionType: string | null
  models: ModelOption[]
  checkedAt: number
}
