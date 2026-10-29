import type { AtelierApi } from '../shared/ipc/api'

declare global {
  interface Window {
    atelier: AtelierApi
  }
}

export {}
