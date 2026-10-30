import { describe, expect, it } from 'vitest'
import { graphRows } from './git-graph'

const c = (hash: string, ...parents: string[]) => ({ hash, parents })

describe('graphRows', () => {
  it('keeps a straight history in one lane', () => {
    const rows = graphRows([c('c', 'b'), c('b', 'a'), c('a')])
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0])
    expect(rows[0]?.segments).toEqual([{ from: 0, to: 0, kind: 'out', color: 0 }])
    expect(rows[1]?.segments).toEqual([
      { from: 0, to: 0, kind: 'in', color: 0 },
      { from: 0, to: 0, kind: 'out', color: 0 }
    ])
    expect(rows[2]?.segments).toEqual([{ from: 0, to: 0, kind: 'in', color: 0 }])
  })

  it('opens a lane for a merged branch and closes it where it started', () => {
    // m merges f (feature) into b; f and b both come from a.
    const rows = graphRows([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')])
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 0])
    expect(rows[0]?.segments).toEqual([
      { from: 0, to: 0, kind: 'out', color: 0 },
      { from: 0, to: 1, kind: 'out', color: 1 }
    ])
    // f runs beside b; under b, f's line bends back into the main lane, which goes on to a.
    expect(rows[1]?.segments).toContainEqual({ from: 0, to: 0, kind: 'pass', color: 0 })
    expect(rows[2]?.segments).toEqual([
      { from: 0, to: 0, kind: 'in', color: 0 },
      { from: 1, to: 0, kind: 'pass', color: 1 },
      { from: 0, to: 0, kind: 'out', color: 0 }
    ])
    expect(rows[3]?.segments).toEqual([{ from: 0, to: 0, kind: 'in', color: 0 }])
    expect(rows.map((r) => r.width)).toEqual([2, 2, 2, 1])
  })

  it('gives unrelated tips their own lanes', () => {
    const rows = graphRows([c('x', 'a'), c('y', 'a'), c('a')])
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0])
    expect(rows[1]?.segments).toContainEqual({ from: 1, to: 0, kind: 'out', color: 0 })
    expect(rows[2]?.segments).toEqual([{ from: 0, to: 0, kind: 'in', color: 0 }])
  })
})
