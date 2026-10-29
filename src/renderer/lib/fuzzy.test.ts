import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from './fuzzy'

describe('fuzzy', () => {
  it('matches subsequences and rejects the rest', () => {
    expect(fuzzyScore('tgl', 'Toggle sidebar')?.positions).toEqual([0, 2, 4])
    expect(fuzzyScore('xyz', 'Toggle sidebar')).toBeNull()
    expect(fuzzyScore('', 'anything')).toEqual({ score: 0, positions: [] })
  })

  it('ranks word starts and consecutive letters first', () => {
    const items = ['src/renderer/App.tsx', 'src/main/app.ts', 'docs/PLAN.md', 'scripts/drive.mjs']
    expect(fuzzyFilter(items, 'app', (s) => s)[0]).toBe('src/main/app.ts')
    expect(fuzzyFilter(items, 'plan', (s) => s)).toEqual(['docs/PLAN.md'])
    expect(fuzzyFilter(['Go to Settings', 'Toggle terminal'], 'term', (s) => s)).toEqual(['Toggle terminal'])
  })
})
