// Launches the built app (run `npm run build` first), runs a list of steps, screenshots each one.
// Usage: node scripts/drive.mjs <outDir> '<steps json>'
// Steps: {"ss":"name"} | {"click":"css"} | {"press":"Control+B"} | {"type":"text"}
//        | {"wait":"css"} | {"select":["css","value"]} | {"drag":["from css","to css"]} | {"mouse":["move",x,y]|["down"]|["up"]} | {"eval":"js expression"} | {"sleep":ms}
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const outDir = resolve(process.argv[2] ?? join(root, 'out', 'shots'))
const steps = JSON.parse(process.argv[3] ?? '[{"ss":"main"}]')
mkdirSync(outDir, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  args: [root],
  timeout: 30_000
})
const logs = []
let page = null
try {
  page = await app.firstWindow()
  page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
  await page.waitForSelector('#root > *', { timeout: 15_000 })
  await page.waitForTimeout(800)
  for (const step of steps) {
    if (step.ss) {
      const file = join(outDir, `${step.ss}.png`)
      await page.screenshot({ path: file })
      console.log('screenshot:', file)
    } else if (step.click) {
      await page.click(step.click, { timeout: 5_000 })
    } else if (step.press) {
      await page.keyboard.press(step.press)
    } else if (step.type) {
      await page.keyboard.type(step.type, { delay: 20 })
    } else if (step.wait) {
      await page.waitForSelector(step.wait, { timeout: 10_000 })
    } else if (step.mouse) {
      const [action, x, y] = step.mouse
      if (action === 'move') await page.mouse.move(x, y, { steps: 8 })
      else await page.mouse[action]()
    } else if (step.drag) {
      await page.dragAndDrop(step.drag[0], step.drag[1], { timeout: 5_000 })
    } else if (step.select) {
      await page.selectOption(step.select[0], step.select[1], { timeout: 5_000 })
    } else if (step.eval) {
      console.log('eval:', JSON.stringify(await page.evaluate(step.eval)))
    } else if (step.sleep) {
      await page.waitForTimeout(step.sleep)
    }
    await page.waitForTimeout(250)
  }
} catch (err) {
  console.log('step failed:', err.message.split('\n')[0])
  if (page) {
    const file = join(outDir, 'error.png')
    await page.screenshot({ path: file })
    console.log('screenshot:', file)
  }
  process.exitCode = 1
} finally {
  for (const line of logs) console.log(line)
  await app.close()
}
