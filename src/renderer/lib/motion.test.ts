import { describe, expect, it } from 'vitest'
import { cascade, duration, effectiveLevel } from './motion'

describe('motion tokens', () => {
  it('keeps every duration between 150 and 300 ms', () => {
    for (const d of Object.values(duration)) {
      expect(d).toBeGreaterThanOrEqual(0.15)
      expect(d).toBeLessThanOrEqual(0.3)
    }
  })

  it('lowers the setting to reduced when the system asks for less motion', () => {
    expect(effectiveLevel('full', false)).toBe('full')
    expect(effectiveLevel('full', true)).toBe('reduced')
    expect(effectiveLevel('reduced', false)).toBe('reduced')
    expect(effectiveLevel('off', true)).toBe('off')
    expect(effectiveLevel('off', false)).toBe('off')
  })

  it('caps the cascade so a long list never waits', () => {
    expect(cascade(0)).toBe(0)
    expect(cascade(1)).toBeCloseTo(0.04)
    expect(cascade(100)).toBe(cascade(6))
    expect(cascade(100)).toBeLessThanOrEqual(0.3)
  })
})
