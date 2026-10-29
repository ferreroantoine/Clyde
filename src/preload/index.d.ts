import type { ClydeApi } from '../shared/ipc/api'

declare global {
  interface Window {
    clyde: ClydeApi
  }
}

export {}
