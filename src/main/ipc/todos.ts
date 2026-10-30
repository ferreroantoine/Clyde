import { handle } from './router'
import type { TodoService } from '../agents/todo-service'

export function registerTodoHandlers(todos: TodoService): void {
  handle('todos:list', () => todos.list())
  handle('todos:create', (input) => todos.create(input))
  handle('todos:update', (input) => todos.update(input))
  handle('todos:delete', ({ id }) => {
    todos.delete(id)
    return null
  })
  handle('todos:assign', ({ id, sessionId }) => todos.assign(id, sessionId))
}
