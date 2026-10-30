/** Lanes of the commit graph in the Source view's history, one row per commit (newest first). */

export interface Segment {
  /** Lane at the top or middle of the row. */
  from: number
  /** Lane at the middle or bottom of the row. */
  to: number
  /** `in`: top → node, `pass`: top → bottom, `out`: node → bottom. */
  kind: 'in' | 'pass' | 'out'
  color: number
}

export interface GraphRow {
  /** The lane of the commit's dot. */
  col: number
  color: number
  segments: Segment[]
  /** Lanes the row uses, for its width. */
  width: number
}

interface Lane {
  hash: string
  color: number
}

/** Commits must come in topological order (children before parents), as `git log --topo-order` gives them. */
export function graphRows(commits: ReadonlyArray<{ hash: string; parents: readonly string[] }>): GraphRow[] {
  const lanes: Array<Lane | null> = []
  let nextColor = 0
  const free = (except = -1) => {
    const i = lanes.findIndex((l, n) => l === null && n !== except)
    return i === -1 ? Math.max(lanes.length, except + 1) : i
  }
  return commits.map((commit) => {
    let col = lanes.findIndex((l) => l?.hash === commit.hash)
    const fresh = col === -1
    if (fresh) {
      col = free()
      lanes[col] = { hash: commit.hash, color: nextColor++ }
    }
    const color = (lanes[col] as Lane).color
    const segments: Segment[] = []
    lanes.forEach((lane, i) => {
      if (!lane) return
      if (lane.hash === commit.hash) {
        if (!(fresh && i === col)) segments.push({ from: i, to: col, kind: 'in', color: lane.color })
        lanes[i] = null
      } else {
        segments.push({ from: i, to: i, kind: 'pass', color: lane.color })
      }
    })
    commit.parents.forEach((parent, k) => {
      const existing = lanes.findIndex((l) => l?.hash === parent)
      if (existing > col && k === 0) {
        // The first parent waits in a lane further right: it moves under this commit, so the
        // main line stays on the left. That lane's line bends into this one.
        const passing = segments.find((s) => s.kind === 'pass' && s.from === existing)
        if (passing) passing.to = col
        lanes[existing] = null
        lanes[col] = { hash: parent, color }
        segments.push({ from: col, to: col, kind: 'out', color })
        return
      }
      if (existing !== -1) {
        segments.push({ from: col, to: existing, kind: 'out', color: (lanes[existing] as Lane).color })
        return
      }
      const slot = k === 0 ? col : free(col)
      lanes[slot] = { hash: parent, color: k === 0 ? color : nextColor++ }
      segments.push({ from: col, to: slot, kind: 'out', color: (lanes[slot] as Lane).color })
    })
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    const width = Math.max(col, ...segments.flatMap((s) => [s.from, s.to])) + 1
    return { col, color, segments, width }
  })
}
