// Writes src/main/licenses.json: name, version and license of every package that ships in the
// app (runtime dependencies, and the UI libraries bundled into the renderer). Run after
// changing dependencies: node scripts/licenses.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// Build and test tooling does not ship.
const TOOLING = /^(@eslint|eslint|typescript|vite|vitest|electron-vite|electron-builder|@vitejs|@types|playwright|globals|tailwindcss|@tailwindcss|tw-animate-css)/
const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}).filter((n) => !TOOLING.test(n))]
const list = names
  .map((name) => {
    try {
      const p = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'))
      const license = typeof p.license === 'string' ? p.license : (p.license?.type ?? 'see package')
      return { name, version: p.version, license }
    } catch {
      return null
    }
  })
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(join(root, 'src/main/licenses.json'), `${JSON.stringify(list, null, 2)}\n`)
console.log(`${list.length} packages`)
