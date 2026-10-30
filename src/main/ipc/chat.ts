import { readFileSync } from 'node:fs'
import { t } from '@shared/i18n'
import { AppError } from '@shared/errors'
import { handle } from './router'
import type { ChatService } from '../chat/service'

export function registerChatHandlers(chat: ChatService): void {
  handle('chat:list', () => chat.list())
  handle('chat:create', (input) => chat.create(input))
  handle('chat:update', (input) => chat.update(input))
  handle('chat:delete', ({ id }) => {
    chat.delete(id)
    return null
  })
  handle('chat:messages', ({ id }) => chat.messages(id))
  handle('chat:send', ({ id, text, attachments }) => chat.send(id, text, attachments))
  handle('chat:edit', async ({ id, messageId, text }) => {
    await chat.edit(id, messageId, text)
    return null
  })
  handle('chat:regenerate', async ({ id }) => {
    await chat.regenerate(id)
    return null
  })
  handle('chat:stop', async ({ id }) => {
    await chat.stop(id)
    return null
  })
  handle('chat:search', ({ query }) => chat.search(query))
  handle('chat:usage', ({ id }) => chat.usage(id))
  handle('chat:live', ({ id }) => chat.liveState(id))
  handle('chat:continueInProject', ({ id }) => chat.continueInProject(id))
  handle('chat:attachment', ({ id, attachmentId }) => {
    const attachment = chat
      .messages(id)
      .flatMap((m) => m.attachments)
      .find((a) => a.id === attachmentId)
    if (!attachment) throw new AppError('not_found', t('This attachment no longer exists'))
    return { mime: attachment.mime, data: readFileSync(chat.attachmentPath(id, attachment)).toString('base64') }
  })
}
