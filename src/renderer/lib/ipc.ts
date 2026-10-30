import type { EventChannel, InvokeChannel } from '@shared/ipc/channels'
import type { EventPayloads, InvokeArgs, InvokeResponses } from '@shared/ipc/contract'

export class IpcClientError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'IpcClientError'
  }
}

/** Calls main and unwraps the result envelope; failures become `IpcClientError`. */
export async function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResponses[C]> {
  const result = await window.clyde.invoke(channel, ...args)
  if (!result.ok) throw new IpcClientError(result.error.code, result.error.message)
  return result.data
}

export function on<E extends EventChannel>(
  channel: E,
  listener: (payload: EventPayloads[E]) => void
): () => void {
  return window.clyde.on(channel, listener)
}
