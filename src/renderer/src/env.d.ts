/// <reference types="vite/client" />

import type { LairScoutAPI } from '@shared/types'

declare global {
  interface Window {
    lairscout: LairScoutAPI
  }
}

export {}
