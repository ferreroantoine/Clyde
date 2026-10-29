import { z } from 'zod'

/**
 * `claude-code` drives Claude Code through the Agent SDK. The others are API providers that
 * run Clyde's own agent loop.
 */
export const PROFILE_KINDS = ['claude-code', 'anthropic', 'openai', 'mistral', 'ollama'] as const
export type ProfileKind = (typeof PROFILE_KINDS)[number]
export type ApiProfileKind = Exclude<ProfileKind, 'claude-code'>

export const PROFILE_KIND_LABELS: Record<ProfileKind, string> = {
  'claude-code': 'Claude Code',
  anthropic: 'Anthropic API',
  openai: 'OpenAI',
  mistral: 'Mistral',
  ollama: 'Ollama'
}

export function isApiKind(kind: ProfileKind): kind is ApiProfileKind {
  return kind !== 'claude-code'
}

/**
 * How a profile signs in. A Claude Code subscription uses Claude Code's own login flow inside
 * the profile's config dir; an API key is stored encrypted; a local Ollama needs nothing.
 */
export const AUTH_MODES = ['subscription', 'api-key', 'none'] as const
export type AuthMode = (typeof AUTH_MODES)[number]

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

/** The auth modes each kind accepts, the first being the default. */
export const KIND_AUTH: Record<ProfileKind, readonly AuthMode[]> = {
  'claude-code': ['subscription', 'api-key'],
  anthropic: ['api-key'],
  openai: ['api-key'],
  mistral: ['api-key'],
  ollama: ['none']
}

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

const name = z.string().trim().min(1, 'Name is required').max(60)
const label = z.string().trim().max(12)
const color = z.enum(PROFILE_COLORS)
const model = z.string().trim().max(200)
const baseUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'Enter an http:// or https:// URL')

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
