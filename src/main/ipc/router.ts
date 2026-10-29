import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { InvokeChannel } from '@shared/ipc/channels'
import { requestSchemas, type InvokeResponses, type ParsedRequest } from '@shared/ipc/contract'
import { toIpcError } from '@shared/errors'
import type { IpcResult } from '@shared/types'
import { createLogger } from '../logger'

const log = createLogger('ipc')

type Handler<C extends InvokeChannel> = (
  request: ParsedRequest<C>,
  event: IpcMainInvokeEvent
) => Promise<InvokeResponses[C]> | InvokeResponses[C]

/** Only our own renderer (dev server or packaged file) may call into main. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl && url.startsWith(devUrl)) return true
  return url.startsWith('file://')
}

export function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
  const schema: z.ZodType = requestSchemas[channel]
  ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<InvokeResponses[C]>> => {
    if (!isTrustedSender(event)) {
      log.warn(`rejected ${channel} from untrusted sender`)
      return { ok: false, error: { code: 'forbidden', message: 'Untrusted sender' } }
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: { code: 'invalid_request', message: z.prettifyError(parsed.error) } }
    }
    try {
      const data = await handler(parsed.data as ParsedRequest<C>, event)
      return { ok: true, data }
    } catch (err) {
      const error = toIpcError(err)
      if (error.code === 'internal') log.error(`${channel} failed`, err)
      return { ok: false, error }
    }
  })
}
