import { z } from 'zod'

/** Phase 2 ships Claude Code profiles; the API providers join this list in Phase 3. */
export const PROFILE_KINDS = ['claude-code'] as const
export type ProfileKind = (typeof PROFILE_KINDS)[number]

/**
 * How a Claude Code profile signs in. A subscription uses Claude Code's own login flow
 * inside the profile's config dir; an API key is stored encrypted and passed as ANTHROPIC_API_KEY.
 */
export const CLAUDE_AUTH_MODES = ['subscription', 'api-key'] as const
export type ClaudeAuthMode = (typeof CLAUDE_AUTH_MODES)[number]

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

export const profileCreateSchema = z.object({
  kind: z.enum(PROFILE_KINDS).default('claude-code'),
  name,
  label: label.default(''),
  color,
  auth: z.enum(CLAUDE_AUTH_MODES),
  defaultModel: model.default(''),
  /** Only for `api-key` profiles. Never stored in clear and never sent back to the renderer. */
  apiKey: z.string().trim().min(1).max(500).optional()
})

export const profileUpdateSchema = z.object({
  id: profileIdSchema,
  name: name.optional(),
  label: label.optional(),
  color: color.optional(),
  defaultModel: model.optional(),
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
  auth: ClaudeAuthMode
  defaultModel: string
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
