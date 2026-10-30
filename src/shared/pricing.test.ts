import { describe, expect, it } from 'vitest'
import { estimateCost, findPrice, type PriceRow } from './pricing'

const row = (kind: PriceRow['kind'], modelPrefix: string, inputPerMTok: number, outputPerMTok: number): PriceRow => ({
  id: modelPrefix,
  kind,
  modelPrefix,
  inputPerMTok,
  outputPerMTok,
  source: 'seed',
  updatedAt: 0
})
const rows = [row('anthropic', 'claude-opus-5', 5, 25), row('anthropic', 'claude-opus-5-5', 4, 20), row('openai', 'gpt-6', 2, 8)]

describe('pricing', () => {
  it('picks the longest matching prefix within the provider', () => {
    expect(findPrice(rows, 'anthropic', 'claude-opus-5-5-20261001')?.inputPerMTok).toBe(4)
    expect(findPrice(rows, 'anthropic', 'Claude-Opus-5')?.inputPerMTok).toBe(5)
    expect(findPrice(rows, 'openai', 'claude-opus-5')).toBeNull()
  })

  it('estimates per million tokens, free for Ollama, unknown without a price', () => {
    expect(estimateCost(rows, 'anthropic', 'claude-opus-5-5', 1_000_000, 100_000)).toBeCloseTo(6)
    expect(estimateCost(rows, 'openai', 'gpt-6-mini', 2000, 1000)).toBeCloseTo(0.012)
    expect(estimateCost(rows, 'ollama', 'qwen3', 5000, 5000)).toBe(0)
    expect(estimateCost(rows, 'openai', 'gpt-5', 10, 10)).toBeNull()
  })
})
