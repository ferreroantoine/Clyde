import { mkdirSync } from 'node:fs'
import { shell } from 'electron'
import { handle } from './router'
import type { MemoryService } from '../memory/service'

export function registerMemoryHandlers(memory: MemoryService): void {
  handle('memory:state', () => memory.state())
  handle('memory:saveCore', ({ scope, text }) => memory.saveCore(scope, text))
  handle('memory:saveDoc', ({ scope, name, title, content }) => memory.saveDoc(scope, name, title, content))
  handle('memory:deleteDoc', ({ scope, name }) => memory.removeDoc(scope, name))
  handle('memory:propose', async ({ sessionId }) => (await memory.proposeFromSession(sessionId)).length)
  handle('memory:consolidate', async ({ scope }) => !!(await memory.consolidate(scope)))
  handle('memory:accept', ({ id, text }) => memory.accept(id, text))
  handle('memory:reject', ({ id }) => memory.reject(id))
  handle('memory:open', async ({ scope }) => {
    const state = memory.state()
    const dir = scope === 'user' ? state.user.dir : state.project?.dir
    if (dir) {
      mkdirSync(dir, { recursive: true })
      await shell.openPath(dir)
    }
    return null
  })
}
