// Launches a packaged build and checks what only a real package can break: the database
// (better-sqlite3), the terminal (node-pty), search (ripgrep) and the bundled Claude Code binary,
// all of which must load from app.asar.unpacked.
// Usage: node scripts/smoke-packaged.mjs <path to the app executable> [screenshot.png]
/* global window -- used inside page.evaluate callbacks, which run in the renderer */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executablePath = resolve(process.argv[2] ?? '')
const screenshot = process.argv[3]
const userData = mkdtempSync(join(tmpdir(), 'clyde-smoke-data-'))
const repo = mkdtempSync(join(tmpdir(), 'clyde-smoke-repo-'))
writeFileSync(join(repo, 'notes.txt'), 'the needle is here\n')
const git = (...args) => execFileSync('git', args, { cwd: repo })
git('init', '-q')
git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@localhost', 'add', '-A')
git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@localhost', 'commit', '-qm', 'init')

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

const app = await electron.launch({ executablePath, env: { ...process.env, CLYDE_USER_DATA: userData }, timeout: 60_000 })
try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))
  await page.waitForSelector('#root > *', { timeout: 30_000 })
  const invoke = (channel, arg) => page.evaluate(([c, a]) => window.clyde.invoke(c, a), [channel, arg])

  check('window title', (await page.title()) === 'Clyde', await page.title())
  const info = await invoke('app:getInfo')
  check('app info', info.ok && info.data.name === 'Clyde', info.ok ? `${info.data.version}, ${info.data.platform}` : info.error.message)
  const settings = await invoke('settings:getAll')
  check('database (better-sqlite3)', settings.ok, settings.ok ? '' : settings.error.message)

  const ws = await invoke('workspace:open', { root: repo })
  check('open a folder', ws.ok, ws.ok ? '' : ws.error.message)
  const found = await invoke('search:text', { query: 'needle' })
  check('search (ripgrep)', found.ok && found.data.matches.length === 1, found.ok ? `${found.data.matches.length} match` : found.error.message)
  const files = await invoke('files:list')
  check('file list (ripgrep)', files.ok && files.data.files.some((f) => f.endsWith('notes.txt')), files.ok ? '' : files.error.message)

  const output = await page.evaluate(async () => {
    let text = ''
    const off = window.clyde.on('pty:data', (e) => (text += e.data))
    const pty = await window.clyde.invoke('pty:create', { cols: 100, rows: 30 })
    if (!pty.ok) return `error: ${pty.error.message}`
    await window.clyde.invoke('pty:write', { id: pty.data.id, data: 'echo smoke-$((40+2))\r' })
    for (let i = 0; i < 100 && !text.includes('smoke-42'); i++) await new Promise((r) => setTimeout(r, 100))
    off()
    await window.clyde.invoke('pty:kill', { id: pty.data.id })
    return text
  })
  check('terminal (node-pty)', output.includes('smoke-42'), output.includes('smoke-42') ? '' : JSON.stringify(output.slice(-300)))

  const profile = await invoke('profiles:create', { name: 'Smoke', color: '#f97316', auth: 'subscription' })
  const test = profile.ok ? await invoke('profiles:test', { id: profile.data.id }) : profile
  check('bundled Claude Code runs', test.ok, test.ok ? test.data.status : test.error.message)

  if (screenshot) await page.screenshot({ path: screenshot })
} catch (err) {
  check('run', false, err instanceof Error ? err.message.split('\n')[0] : String(err))
} finally {
  await app.close().catch(() => {})
  rmSync(userData, { recursive: true, force: true })
  rmSync(repo, { recursive: true, force: true })
}

const failed = checks.filter((c) => !c.ok)
console.log(failed.length ? `${failed.length} check(s) failed` : `all ${checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)
