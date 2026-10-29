import { sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unpackedPath } from './unpacked'

describe('unpackedPath', () => {
  it('points into app.asar.unpacked and leaves other paths alone', () => {
    const packed = ['C:', 'Program Files', 'Clyde', 'resources', 'app.asar', 'node_modules', 'rg.exe'].join(sep)
    expect(unpackedPath(packed)).toBe(packed.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`))
    const dev = ['home', 'me', 'clyde', 'node_modules', 'rg'].join(sep)
    expect(unpackedPath(dev)).toBe(dev)
  })
})
