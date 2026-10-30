import { existsSync } from 'node:fs'
import type { Db } from './database'

/**
 * The Kanban of worktree tasks becomes the shared task list. Tasks are copied over (to do →
 * To do; in progress and to review → In progress; done → Done), without their worktrees.
 * Worktrees and `clyde/…` branches that were neither merged nor abandoned are listed in a
 * notice: Clyde does not delete them, the user decides.
 */
export function tasksToTodos(db: Db): void {
  const rows = db
    .prepare('SELECT repo_root, branch, worktree_path, outcome, status FROM tasks ORDER BY created_at')
    .all() as Array<{ repo_root: string; branch: string; worktree_path: string; outcome: string | null; status: string }>
  db.exec(`
    INSERT INTO todos (id, root, text, status, session_id, origin, position, created_at, updated_at, done_at)
      SELECT id, repo_root, title,
             CASE status WHEN 'todo' THEN 'todo' WHEN 'done' THEN 'done' ELSE 'in_progress' END,
             session_id, 'user', position, created_at, updated_at,
             CASE status WHEN 'done' THEN updated_at END
      FROM tasks;
    DROP TABLE tasks;
  `)
  const left = rows.filter((r) => r.outcome === null && r.worktree_path && existsSync(r.worktree_path)).map((r) => ({ path: r.worktree_path, branch: r.branch, repo: r.repo_root }))
  if (left.length === 0) return
  db.prepare('INSERT INTO app_notices (type, payload, created_at) VALUES (?, ?, ?)').run('task-worktrees-left', JSON.stringify({ worktrees: left }), Date.now())
}
