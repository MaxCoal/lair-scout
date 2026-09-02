export type SessionStatus = 'idle' | 'loading' | 'in_queue' | 'admitted' | 'error'

export type InstanceSnapshot = {
  id: string
  url: string
  host: string
  title: string
  status: SessionStatus
  waitTime?: string
  queueNumber?: string
  screenshot?: string
  poppedOut: boolean
  error?: string
  admittedFlash: boolean
}

export type ClickPayload = {
  id: string
  nx: number
  ny: number
  button?: 'left' | 'right' | 'middle'
  double?: boolean
}

export type KeyPayload = {
  id: string
  key: string
  type: 'down' | 'up' | 'press'
}

export type ScrollPayload = {
  id: string
  dx: number
  dy: number
}

export type MovePayload = {
  id: string
  nx: number
  ny: number
}

export type FoxboxAPI = {
  spawn: () => Promise<void>
  kill: (id: string) => Promise<void>
  gotoAll: (url: string) => Promise<void>
  gotoOne: (id: string, url: string) => Promise<void>
  reload: (id: string) => Promise<void>
  click: (payload: ClickPayload) => Promise<void>
  key: (payload: KeyPayload) => Promise<void>
  scroll: (payload: ScrollPayload) => Promise<void>
  move: (payload: MovePayload) => Promise<void>
  popOut: (id: string) => Promise<void>
  dock: (id: string) => Promise<void>
  setMuted: (muted: boolean) => Promise<void>
  setFocused: (id: string | null) => Promise<void>
  onUpdate: (cb: (instances: InstanceSnapshot[]) => void) => () => void
  onAdmitted: (cb: (id: string) => void) => () => void
}
