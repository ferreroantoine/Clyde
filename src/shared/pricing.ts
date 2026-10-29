import { z } from 'zod'
import type { ProfileKind } from './profiles'

/** Kinds Atelier estimates a cost for: the API kinds. Claude Code reports its own; Ollama runs locally for free. */
export const PRICED_KINDS = ['anthropic', 'openai', 'gemini'] as const
export type PricedKind = (typeof PRICED_KINDS)[number]

export const priceInputSchema = z.object({
  kind: z.enum(PRICED_KINDS),
  /** Matches model ids that start with it; the longest matching prefix wins. */
  modelPrefix: z.string().trim().min(1).max(200),
  inputPerMTok: z.number().min(0).max(10_000),
  outputPerMTok: z.number().min(0).max(10_000)
})
export type PriceInput = z.input<typeof priceInputSchema>

export interface PriceRow extends z.output<typeof priceInputSchema> {
  id: string
  /** `seed` rows ship with Atelier; editing one makes it `user`. */
  source: 'seed' | 'user'
  updatedAt: number
}

/** Longest prefix match, case-insensitive, within one provider. */
export function findPrice(rows: readonly PriceRow[], kind: ProfileKind, model: string): PriceRow | null {
  const id = model.toLowerCase()
  let best: PriceRow | null = null
  for (const row of rows) {
    if (row.kind !== kind) continue
    const prefix = row.modelPrefix.toLowerCase()
    if (id.startsWith(prefix) && (!best || prefix.length > best.modelPrefix.length)) best = row
  }
  return best
}

/**
 * Estimated cost of one turn in USD, at list input and output prices (cache discounts are not
 * applied, so it errs high). Null when no price is known for the model.
 */
export function estimateCost(
  rows: readonly PriceRow[],
  kind: ProfileKind,
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  // Local models are free; Codex and Antigravity run on a subscription, which has no per-turn price.
  if (kind === 'ollama' || kind === 'codex' || kind === 'antigravity') return 0
  const price = findPrice(rows, kind, model)
  if (!price) return null
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000
}
