import type { EventChannel, InvokeChannel } from './channels'
import type { EventPayloads, InvokeArgs, InvokeResponses } from './contract'
import type { IpcResult } from '../types'

/** Shape of `window.clyde`, the only bridge between renderer and main. */
export interface ClydeApi {
  platform: string
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeArgs<C>
  ): Promise<IpcResult<InvokeResponses[C]>>
  on<E extends EventChannel>(channel: E, listener: (payload: EventPayloads[E]) => void): () => void
}
