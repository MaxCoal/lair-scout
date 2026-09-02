export type SessionStatus =
  | 'idle'
  | 'loading'
  | 'not_in_queue'
  | 'waiting_for_queue'
  | 'in_queue'
  | 'admitted'
  | 'error'

export type QueueNotice = {
  id: string
  header: string
  time: string
  text: string
  kind: 'message' | 'stock'
}

export type InstanceSnapshot = {
  id: string
  url: string
  host: string
  title: string
  status: SessionStatus
  statusLabel: string
  waitTime?: string
  queueNumber?: string
  queueNotice?: QueueNotice
  screenshot?: string
  interacting: boolean
  poppedOut: boolean
  focused?: boolean
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

export type RamSnapshot = {
  usedBytes: number
  totalBytes: number
  freeBytes: number
  scoutBytes: number
  percent: number
  usedLabel: string
  totalLabel: string
  scoutLabel: string
  cpuPercent: number
  cpuScoutPercent: number
  gpuPercent: number | null
  gpuName: string
}

export type ShippingProfile = {
  email: string
  firstName: string
  lastName: string
  address1: string
  address2: string
  city: string
  state: string
  zip: string
}

export type ThemeId = 'dungeon' | 'daylight'

export type AppSettings = ShippingProfile & {
  theme: ThemeId
}

export type LairScoutAPI = {
  spawn: () => Promise<void>
  scaleTo: (count: number) => Promise<void>
  kill: (id: string) => Promise<void>
  restart: (id: string) => Promise<void>
  gotoAll: (url: string) => Promise<void>
  rushCheckout: () => Promise<void>
  gotoOne: (id: string, url: string) => Promise<void>
  reload: (id: string) => Promise<void>
  click: (payload: ClickPayload) => void
  key: (payload: KeyPayload) => void
  scroll: (payload: ScrollPayload) => void
  move: (payload: MovePayload) => void
  popOut: (id: string) => Promise<void>
  dock: (id: string) => Promise<void>
  interact: (id: string, rect: { x: number; y: number; width: number; height: number }) => Promise<void>
  stopInteract: (id: string) => Promise<void>
  openDriveWindow: () => Promise<void>
  closeDriveWindow: () => Promise<void>
  setMuted: (muted: boolean) => Promise<void>
  setFocused: (id: string | null) => Promise<void>
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<AppSettings>
  onUpdate: (cb: (instances: InstanceSnapshot[]) => void) => () => void
  onAdmitted: (cb: (id: string) => void) => () => void
  onQueuePopped: (cb: (id: string) => void) => () => void
  onQueueMessage: (cb: (payload: { foxId: string; notice: QueueNotice }) => void) => () => void
  onRam: (cb: (ram: RamSnapshot) => void) => () => void
  onSettings: (cb: (settings: AppSettings) => void) => () => void
}
