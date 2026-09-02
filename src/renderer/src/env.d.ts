/// <reference types="vite/client" />

import type { FoxboxAPI } from '@shared/types'

declare global {
  interface Window {
    foxbox: FoxboxAPI
  }
}

export {}
