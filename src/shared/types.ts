export type SessionStatus =
  | 'idle'
  | 'loading'
  | 'not_in_queue'
  | 'waiting_for_queue'
  | 'in_queue'
  | 'admitted'
  | 'hunting'
  | 'purchasing'
  | 'purchased'
  | 'aborted'
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
  admittedAt?: number   // epoch ms when admitted; undefined if not yet admitted
  unhealthy?: boolean   // true when the scout appears stalled or crashed
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
  name: string
  address: string
  phone: string
  email: string
}

export type ThemeId = 'dungeon' | 'daylight'

export type FoilHint = 'any' | 'foil' | 'nonfoil'

export type AppMode = 'manual' | 'auto'

export type FullAutoPhase =
  | 'idle'
  | 'armed'
  | 'warming'
  | 'hunting'
  | 'matched'
  | 'rushing'
  | 'in_queue'
  | 'purchasing'
  | 'done'
  | 'aborted'
  | 'error'

export type ProductCandidate = {
  title: string
  url: string
  score: number
  isNew: boolean
}

export type FullAutoArmInput = {
  productQuery: string
  foilHint: FoilHint
  goLiveAt: number
  warmupMinutes: number
  fleetSize: number
  maxOrders: number
  qtyPerOrder: number
  cvv: string
}

export type FullAutoStatus = {
  phase: FullAutoPhase
  productQuery: string
  foilHint: FoilHint
  goLiveAt: number
  warmupMinutes: number
  fleetSize: number
  maxOrders: number
  qtyPerOrder: number
  matchedTitle: string
  matchedUrl: string
  ordersConfirmed: number
  candidates: ProductCandidate[]
  error?: string
  hasCvv: boolean
}

export type AppSettings = ShippingProfile & {
  theme: ThemeId
  cardHolderName: string
  cardLast4: string
  cardExpiry: string
  hasCard: boolean
  hasLlmKey: boolean
}

export type SettingsUpdate = ShippingProfile & {
  theme: ThemeId
  cardHolderName?: string
  cardNumber?: string
  cardExpiry?: string
  llmApiKey?: string
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
  saveSettings: (settings: SettingsUpdate) => Promise<AppSettings>
  getFullAuto: () => Promise<FullAutoStatus>
  armFullAuto: (input: FullAutoArmInput) => Promise<FullAutoStatus>
  disarmFullAuto: () => Promise<FullAutoStatus>
  onUpdate: (cb: (instances: InstanceSnapshot[]) => void) => () => void
  onAdmitted: (cb: (id: string) => void) => () => void
  onQueuePopped: (cb: (id: string) => void) => () => void
  onQueueMessage: (cb: (payload: { foxId: string; notice: QueueNotice }) => void) => () => void
  onRam: (cb: (ram: RamSnapshot) => void) => () => void
  onSettings: (cb: (settings: AppSettings) => void) => () => void
  onFullAuto: (cb: (status: FullAutoStatus) => void) => () => void
  quit: () => Promise<void>
}
