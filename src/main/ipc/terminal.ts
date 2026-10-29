import { handle } from './router'
import type { PtyService } from '../services/pty'
import type { WorkspaceService } from '../services/workspace'

export function registerTerminalHandlers(ptys: PtyService, workspace: WorkspaceService): void {
  handle('pty:create', ({ cwd, cols, rows }) =>
    ptys.create({ cwd: cwd ?? workspace.current()?.root, cols, rows })
  )
  handle('pty:write', ({ id, data }) => {
    ptys.write(id, data)
    return null
  })
  handle('pty:resize', ({ id, cols, rows }) => {
    ptys.resize(id, cols, rows)
    return null
  })
  handle('pty:kill', ({ id }) => {
    ptys.kill(id)
    return null
  })
}
