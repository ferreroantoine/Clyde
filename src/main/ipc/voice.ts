import { systemPreferences } from 'electron'
import { handle } from './router'
import type { VoiceService } from '../voice/service'

export function registerVoiceHandlers(voice: VoiceService): void {
  handle('voice:status', () => voice.status())
  // Downloads report through `voice:progress`; the call returns at once.
  handle('voice:installBinary', () => {
    void voice.installBinary().catch(() => undefined)
    return null
  })
  handle('voice:downloadModel', ({ id }) => {
    void voice.downloadModel(id).catch(() => undefined)
    return null
  })
  handle('voice:deleteModel', ({ id }) => voice.deleteModel(id))
  handle('voice:cancel', ({ id }) => {
    voice.cancel(id)
    return null
  })
  handle('voice:transcribe', ({ audio }) => voice.transcribe(Buffer.from(audio, 'base64')))
  handle('voice:micAccess', async () => {
    // Only macOS asks per app; elsewhere the system setting applies and getUserMedia reports it.
    if (process.platform !== 'darwin') return true
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true
    return systemPreferences.askForMediaAccess('microphone')
  })
}
