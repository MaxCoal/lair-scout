import { BrowserWindow, Notification, app, screen } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { AppSettings, InstanceSnapshot, RamSnapshot, ShippingProfile } from '@shared/types'
import { findScoutWindow, hideScoutWindow, moveScoutWindow, placeScoutWindow, postWindowMessage, setClipChildren, showWindow, stopWin32Host } from './win32'
import { readRam } from './memory'
import { emptySettings, loadSettings, saveSettings } from './settings'

const DEFAULT_COUNT = 2
const MAX_FLEET = 20

type WindowState = {
  hwnd: number
  pid: number
  profileDir: string
  poppedOut: boolean
  interacting: boolean
  lastPhys?: { x: number; y: number; width: number; height: number }
}

type StageRect = { x: number; y: number; width: number; height: number }

type WorkerHandle = {
  foxId: string
  child: ChildProcessWithoutNullStreams
  ready: Promise<void>
  markReady: () => void
}

type Pending = {
  foxId: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class ScoutManager {
  private window: BrowserWindow | null = null
  private workers = new Map<string, WorkerHandle>()
  private nextId = 1
  private nextRequest = 1
  private pending = new Map<number, Pending>()
  private snapshots: InstanceSnapshot[] = []
  private windows = new Map<string, WindowState>()
  private muted = false
  private shuttingDown = false
  private shipping: ShippingProfile = { name: '', address: '' }
  private settings: AppSettings = emptySettings()
  private dockTimer: NodeJS.Timeout | null = null
  private ramTimer: NodeJS.Timeout | null = null
  private relayoutTimer: NodeJS.Timeout | null = null
  private relayoutBusy = false
  private relayoutQueued = false
  private relayoutAllowResize = false
  private quietUntil = 0
  private clipOn = false
  private mouseHooked = false
  private interactChain: Promise<void> = Promise.resolve()
  private stageRect: StageRect | null = null
  private strayState: 'pending' | 'cleaning' | 'done' = 'pending'
  private strayDone: Promise<void>
  private markStrayDone: () => void = () => undefined
  private seenNotices = new Set<string>()

  constructor() {
    this.strayDone = new Promise((resolve) => {
      this.markStrayDone = resolve
    })
  }

  attach(window: BrowserWindow): void {
    this.window = window
    this.armDockTimer()
    this.armRamTimer()
    this.hookMouseMessages(window)
    void loadSettings().then((settings) => {
      this.settings = settings
      this.shipping = { name: settings.name, address: settings.address }
      this.broadcastSettings()
      void this.pushProfile()
    })
    window.on('move', () => {
      this.scheduleRelayout(false)
    })
    window.on('resize', () => {
      this.scheduleRelayout(true)
    })
  }

  getSettings(): AppSettings {
    return this.settings
  }

  async saveProfile(settings: AppSettings): Promise<AppSettings> {
    this.settings = await saveSettings(settings)
    this.shipping = { name: this.settings.name, address: this.settings.address }
    this.broadcastSettings()
    await this.pushProfile()
    return this.settings
  }

  private broadcastSettings(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('settings:update', this.settings)
    }
  }

  private async pushProfile(): Promise<void> {
    await Promise.all(
      [...this.workers.keys()].map((id) =>
        this.callOn(id, 'setProfile', { profile: this.shipping }).catch(() => undefined)
      )
    )
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  async setFocused(id: string | null): Promise<void> {
    this.forEachWorker((handle) => this.write(handle, { requestId: 0, cmd: 'setFocused', foxId: id }))
  }

  list(): InstanceSnapshot[] {
    return this.snapshots
  }

  async startDefaultFleet(): Promise<void> {
    await Promise.all(Array.from({ length: DEFAULT_COUNT }, () => this.spawn()))
  }

  async spawn(): Promise<string> {
    return this.launch(String(this.nextId++))
  }

  async restart(id: string): Promise<void> {
    const snap = this.snapshots.find((fox) => fox.id === id)
    const url = snap?.url && /^https?:/i.test(snap.url) ? snap.url : undefined
    const state = this.windows.get(id)
    if (state?.interacting) {
      state.interacting = false
      this.fireOn(id, 'setPaused', { foxId: id, paused: false })
    }
    if (this.windows.has(id)) {
      await this.callOn(id, 'kill', { foxId: id }).catch(() => undefined)
      this.disposeWorker(id)
      this.windows.delete(id)
      this.rebuildSnapshots()
      this.broadcast()
    }
    await this.launch(id)
    if (url) await this.gotoOne(id, url)
  }

  private async launch(id: string): Promise<string> {
    const handle = await this.bootWorker(id)
    await Promise.race([
      handle.ready,
      sleep(20000).then(() => {
        throw new Error('Chromium worker did not start. Is Node.js on PATH?')
      })
    ])
    const profileDir = join(app.getPath('userData'), 'scouts', `${id}-${Date.now()}`)
    this.windows.set(id, { hwnd: 0, pid: 0, profileDir, poppedOut: false, interacting: false })
    this.rebuildSnapshots()
    this.broadcast()
    const result = (await this.callOn(id, 'spawn', { foxId: id, profileDir }, 120000)) as { pid?: number }
    const state = this.windows.get(id)
    if (state && result?.pid) state.pid = result.pid
    if (state) {
      state.hwnd = await hideScoutWindow({
        pid: state.pid,
        hwnd: state.hwnd,
        title: `LairScout-${id}`,
        owner: this.ownerHwnd()
      })
    }
    this.broadcast()
    return id
  }

  async scaleTo(target: number): Promise<void> {
    const n = Math.max(0, Math.min(MAX_FLEET, Math.floor(Number(target) || 0)))
    const adds: Promise<string>[] = []
    while (this.windows.size + adds.length < n) {
      adds.push(this.spawn())
    }
    if (adds.length) await Promise.all(adds)
    const extra = [...this.windows.keys()].slice(n)
    if (extra.length) await Promise.all(extra.map((id) => this.kill(id)))
  }

  async kill(id: string): Promise<void> {
    await this.callOn(id, 'kill', { foxId: id }).catch(() => undefined)
    this.disposeWorker(id)
    this.windows.delete(id)
    this.rebuildSnapshots()
    this.broadcast()
  }

  async gotoAll(url: string): Promise<void> {
    await Promise.allSettled(
      [...this.workers.keys()].map((id) => this.callOn(id, 'goto', { foxId: id, url }))
    )
  }

  async rushCheckout(): Promise<void> {
    await Promise.allSettled(
      [...this.workers.keys()].map((id) => this.callOn(id, 'rushCheckout', {}, 150000))
    )
  }

  async gotoOne(id: string, url: string): Promise<void> {
    await this.callOn(id, 'goto', { foxId: id, url })
  }

  async reload(id: string): Promise<void> {
    await this.callOn(id, 'reload', { foxId: id })
  }

  click(
    id: string,
    nx: number,
    ny: number,
    button: 'left' | 'right' | 'middle' = 'left',
    double = false
  ): void {
    this.input(id, 'click', { nx, ny, button, double })
  }

  move(id: string, nx: number, ny: number): void {
    this.input(id, 'move', { nx, ny })
  }

  key(id: string, key: string, type: 'down' | 'up' | 'press'): void {
    this.input(id, 'key', { key, keyType: type })
  }

  scroll(id: string, dx: number, dy: number): void {
    this.input(id, 'scroll', { dx, dy })
  }

  async interact(id: string, rect: StageRect): Promise<void> {
    const run = async (): Promise<void> => {
      this.stageRect = rect
      const state = this.windows.get(id)
      if (!state) return
      await this.embedLive(id, state, rect)
    }
    this.interactChain = this.interactChain.then(run, run)
    await this.interactChain
  }

  async stopInteract(id: string): Promise<void> {
    const state = this.windows.get(id)
    if (!state) return
    if (state.poppedOut) {
      state.interacting = false
      return
    }
    state.interacting = false
    state.lastPhys = undefined
    state.hwnd = await hideScoutWindow({
      pid: state.pid,
      hwnd: state.hwnd,
      title: `LairScout-${id}`,
      owner: this.ownerHwnd()
    })
    this.fireOn(id, 'setPaused', { foxId: id, paused: false })
    if (![...this.windows.values()].some((item) => item.interacting)) {
      await this.ensureClip(false)
    }
    this.broadcast()
  }

  async popOut(id: string): Promise<void> {
    const run = async (): Promise<void> => {
      const state = this.windows.get(id)
      if (!state) return
      state.interacting = false
      state.lastPhys = undefined
      state.poppedOut = true
      const hwnd = await findScoutWindow({ pid: state.pid, hwnd: state.hwnd, title: `LairScout-${id}` })
      if (hwnd) state.hwnd = hwnd
      if (state.hwnd) await showWindow(state.hwnd)
      this.fireOn(id, 'setPaused', { foxId: id, paused: true })
      if (![...this.windows.values()].some((item) => item.interacting)) {
        await this.ensureClip(false)
      }
      this.broadcast()
    }
    this.interactChain = this.interactChain.then(run, run)
    await this.interactChain
  }

  async dock(id: string): Promise<void> {
    const run = async (): Promise<void> => {
      const state = this.windows.get(id)
      if (!state) return
      state.poppedOut = false
      state.lastPhys = undefined
      if (this.stageRect) {
        state.interacting = false
        await this.embedLive(id, state, this.stageRect)
        return
      }
      state.interacting = false
      state.hwnd = await hideScoutWindow({
        pid: state.pid,
        hwnd: state.hwnd,
        title: `LairScout-${id}`,
        owner: this.ownerHwnd()
      })
      this.fireOn(id, 'setPaused', { foxId: id, paused: false })
      if (![...this.windows.values()].some((item) => item.interacting)) {
        await this.ensureClip(false)
      }
      this.broadcast()
    }
    this.interactChain = this.interactChain.then(run, run)
    await this.interactChain
  }

  private async embedLive(id: string, state: WindowState, rect: StageRect): Promise<void> {
    if (rect.width < 80 || rect.height < 60) return
    if (state.poppedOut) return
    if (state.interacting) {
      const moved = await this.placeState(id, state, rect, 'move')
      if (moved) state.hwnd = moved
      return
    }
    state.interacting = true
    state.poppedOut = false
    this.fireOn(id, 'setPaused', { foxId: id, paused: true })
    for (const [otherId, other] of this.windows) {
      if (otherId !== id && other.interacting) {
        other.interacting = false
        other.lastPhys = undefined
        this.fireOn(otherId, 'setPaused', { foxId: otherId, paused: false })
        await hideScoutWindow({
          pid: other.pid,
          hwnd: other.hwnd,
          title: `LairScout-${otherId}`,
          owner: this.ownerHwnd()
        })
      }
    }
    await this.ensureClip(true)
    if (state.poppedOut) return
    const placed = await this.placeState(id, state, rect, 'place')
    if (state.poppedOut) {
      state.interacting = false
      if (state.hwnd) await showWindow(state.hwnd)
      return
    }
    if (placed) state.hwnd = placed
    this.broadcast()
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.dockTimer) clearInterval(this.dockTimer)
    if (this.relayoutTimer) clearTimeout(this.relayoutTimer)
    if (this.ramTimer) clearInterval(this.ramTimer)
    const ids = [...this.workers.keys()]
    await Promise.allSettled(ids.map((id) => this.callOn(id, 'shutdown', {}).catch(() => undefined)))
    for (const id of ids) this.disposeWorker(id)
    stopWin32Host()
  }

  private async placeState(
    id: string,
    state: WindowState,
    rect: StageRect,
    mode: 'place' | 'move'
  ): Promise<number> {
    if (!this.window || this.window.isDestroyed()) return 0
    const content = this.window.getContentBounds()
    const dip = {
      x: content.x + rect.x,
      y: content.y + rect.y,
      width: Math.max(100, rect.width),
      height: Math.max(80, rect.height)
    }
    const phys = screen.dipToScreenRect(this.window, dip)
    const next = {
      x: Math.round(phys.x),
      y: Math.round(phys.y),
      width: Math.round(phys.width),
      height: Math.round(phys.height)
    }
    if (state.lastPhys) {
      const samePos =
        Math.abs(state.lastPhys.x - next.x) < 4 && Math.abs(state.lastPhys.y - next.y) < 4
      const sameSize =
        Math.abs(state.lastPhys.width - next.width) < 8 &&
        Math.abs(state.lastPhys.height - next.height) < 8
      if (mode === 'move') {
        next.width = state.lastPhys.width
        next.height = state.lastPhys.height
        if (samePos) return state.hwnd
      } else if (samePos && sameSize) {
        return state.hwnd
      }
    }
    const opts = { pid: state.pid, hwnd: state.hwnd, title: `LairScout-${id}`, owner: this.ownerHwnd() }
    const hwnd = mode === 'place' ? await placeScoutWindow(opts, next) : await moveScoutWindow(opts, next)
    this.quietUntil = Date.now() + 300
    if (hwnd) state.lastPhys = next
    return hwnd
  }

  private ownerHwnd(): number {
    if (!this.window || this.window.isDestroyed()) return 0
    const buf = this.window.getNativeWindowHandle()
    return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0)
  }

  private hookMouseMessages(window: BrowserWindow): void {
    if (this.mouseHooked) return
    this.mouseHooked = true
    const messages = [0x020e, 0x0207, 0x0208, 0x0209]
    for (const msg of messages) {
      try {
        window.hookWindowMessage(msg, (wParam, lParam) => {
          void this.forwardMouse(msg, wParam, lParam)
        })
      } catch {
        /* not Windows / unsupported */
      }
    }
  }

  private async forwardMouse(msg: number, wParam: Buffer | number, lParam: Buffer | number): Promise<void> {
    let hwnd = 0
    for (const state of this.windows.values()) {
      if (state.interacting && state.hwnd) {
        hwnd = state.hwnd
        break
      }
    }
    if (!hwnd) return
    await postWindowMessage(hwnd, msg, wordToUInt(wParam), wordToUInt(lParam))
  }

  private async ensureClip(clip: boolean): Promise<void> {
    if (this.clipOn === clip) return
    this.clipOn = clip
    this.quietUntil = Date.now() + 300
    await setClipChildren(this.ownerHwnd(), clip)
  }

  private scheduleRelayout(allowResize: boolean): void {
    if (this.shuttingDown || Date.now() < this.quietUntil) return
    if (allowResize) this.relayoutAllowResize = true
    if (this.relayoutTimer) clearTimeout(this.relayoutTimer)
    this.relayoutTimer = setTimeout(() => {
      this.relayoutTimer = null
      this.queueRelayout()
    }, allowResize ? 160 : 80)
  }

  private queueRelayout(): void {
    if (Date.now() < this.quietUntil) return
    if (this.relayoutBusy) {
      this.relayoutQueued = true
      return
    }
    void this.relayoutInteract()
  }

  private async relayoutInteract(): Promise<void> {
    if (!this.stageRect || this.relayoutBusy) {
      if (this.relayoutBusy) this.relayoutQueued = true
      return
    }
    this.relayoutBusy = true
    const allowResize = this.relayoutAllowResize
    this.relayoutAllowResize = false
    try {
      for (const [id, state] of this.windows) {
        if (!state.interacting) continue
        const hwnd = await this.placeState(id, state, this.stageRect, allowResize ? 'place' : 'move')
        if (hwnd) state.hwnd = hwnd
      }
    } finally {
      this.relayoutBusy = false
      if (this.relayoutQueued) {
        this.relayoutQueued = false
        void this.relayoutInteract()
      }
    }
  }

  private armRamTimer(): void {
    if (this.ramTimer) return
    const tick = (): void => {
      if (this.shuttingDown) return
      const pids = [process.pid]
      for (const handle of this.workers.values()) pids.push(handle.child.pid ?? 0)
      for (const state of this.windows.values()) pids.push(state.pid)
      void readRam(pids).then((ram) => {
        if (this.shuttingDown) return
        this.emitRam(ram)
      })
    }
    tick()
    this.ramTimer = setInterval(tick, 2000)
  }

  private emitRam(ram: RamSnapshot): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('stats:ram', ram)
    }
  }

  private armDockTimer(): void {
    if (this.dockTimer) return
    this.dockTimer = setInterval(() => {
      if (this.shuttingDown) return
      for (const [id, state] of this.windows) {
        if (state.poppedOut || state.interacting) continue
        void hideScoutWindow({
          pid: state.pid,
          hwnd: state.hwnd,
          title: `LairScout-${id}`,
          owner: this.ownerHwnd()
        }).then((hwnd) => {
          if (hwnd) state.hwnd = hwnd
        })
      }
    }, 2000)
  }

  private async bootWorker(id: string): Promise<WorkerHandle> {
    if (this.strayState === 'cleaning') await this.strayDone
    const killStray = this.strayState === 'pending'
    if (killStray) this.strayState = 'cleaning'
    const existing = this.workers.get(id)
    if (existing) return existing

    const workerPath =
      !app.isPackaged && existsSync(join(process.cwd(), 'src/main/scoutWorker.cjs'))
        ? join(process.cwd(), 'src/main/scoutWorker.cjs')
        : join(__dirname, 'scoutWorker.cjs')
    const nodePath = resolveNode()
    const env = { ...process.env }
    delete env.PLAYWRIGHT_BROWSERS_PATH
    delete env.ELECTRON_RUN_AS_NODE
    if (killStray) env.LAIRSCOUT_KILL_STRAY = '1'
    else delete env.LAIRSCOUT_KILL_STRAY

    let settled = false
    let markReady: () => void = () => undefined
    const ready = new Promise<void>((resolve) => {
      markReady = () => {
        if (settled) return
        settled = true
        resolve()
      }
    })

    const child = spawn(nodePath, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true
    })
    const handle: WorkerHandle = { foxId: id, child, ready, markReady }
    this.workers.set(id, handle)

    child.stderr.on('data', (chunk) => {
      console.error(`[stack-worker ${id}]`, String(chunk))
    })

    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => this.onLine(id, line))
    child.on('exit', (code) => {
      handle.markReady()
      if (this.strayState === 'cleaning') {
        this.strayState = 'done'
        this.markStrayDone()
      }
      for (const [requestId, pending] of this.pending) {
        if (pending.foxId !== id) continue
        pending.reject(new Error(`Chromium worker exited (${code ?? 'unknown'})`))
        this.pending.delete(requestId)
      }
      if (this.workers.get(id) === handle) this.workers.delete(id)
      if (!this.shuttingDown && this.windows.has(id)) {
        console.error(`Chromium worker for Scout ${id} exited unexpectedly`, code)
      }
    })
    return handle
  }

  private disposeWorker(id: string): void {
    const handle = this.workers.get(id)
    if (!handle) return
    this.workers.delete(id)
    try {
      handle.child.kill()
    } catch {
      /* gone */
    }
  }

  private onLine(foxId: string, line: string): void {
    if (!line.trim()) return
    let message: {
      type: string
      event?: string
      payload?: unknown
      requestId?: number
      ok?: boolean
      result?: unknown
      error?: string
    }
    try {
      message = JSON.parse(line)
    } catch {
      console.error(`[stack-worker ${foxId}] bad line`, line)
      return
    }

    if (message.type === 'result' && message.requestId != null) {
      const pending = this.pending.get(message.requestId)
      if (!pending) return
      this.pending.delete(message.requestId)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(message.error || 'Worker error'))
      return
    }

    if (message.type === 'event' && message.event === 'browserPid') {
      const payload = message.payload as { foxId: string; pid: number }
      const state = this.windows.get(String(payload.foxId))
      if (state) {
        state.pid = Number(payload.pid) || 0
        void hideScoutWindow({
          pid: state.pid,
          hwnd: state.hwnd,
          title: `LairScout-${payload.foxId}`,
          owner: this.ownerHwnd()
        }).then((hwnd) => {
          if (hwnd) state.hwnd = hwnd
        })
      }
      return
    }

    if (message.type === 'event' && message.event === 'ready') {
      const handle = this.workers.get(foxId)
      handle?.markReady()
      if (this.strayState === 'cleaning') {
        this.strayState = 'done'
        this.markStrayDone()
      }
      void this.callOn(foxId, 'setProfile', { profile: this.shipping }).catch(() => undefined)
      return
    }

    if (message.type === 'event' && message.event === 'update') {
      const incoming = (message.payload as InstanceSnapshot[]) || []
      this.rebuildSnapshots(incoming)
      this.broadcast()
      return
    }

    if (message.type === 'event' && message.event === 'queueMessage') {
      const payload = message.payload as {
        foxId?: string
        notice?: { id?: string; header?: string; time?: string; text?: string; kind?: 'message' | 'stock' }
      }
      const notice = payload?.notice
      const text = String(notice?.text || '').trim()
      if (!text) return
      const kind = notice?.kind === 'stock' || /sold out|out of stock/i.test(text) ? 'stock' : 'message'
      const key = `${notice?.id || ''}|${kind}|${text}`
      if (this.seenNotices.has(key)) return
      this.seenNotices.add(key)
      const title = kind === 'stock' ? 'Out of stock' : notice?.time ? `Queue message · ${notice.time}` : 'Queue message'
      this.emitNotice('instances:queueMessage', String(payload.foxId || foxId), title, text, {
        foxId: String(payload.foxId || foxId),
        notice: {
          id: String(notice?.id || key),
          header: String(notice?.header || (kind === 'stock' ? 'Out of stock' : 'Message')),
          time: String(notice?.time || ''),
          text,
          kind
        }
      })
      return
    }

    if (message.type === 'event' && message.event === 'admitted') {
      const id = String(message.payload)
      this.emitAlert('instances:admitted', id, `Scout ${id} is through the queue`)
      return
    }

    if (message.type === 'event' && message.event === 'queuePopped') {
      const id = String(message.payload)
      this.emitAlert('instances:queuePopped', id, `Scout ${id}: queue started`)
      return
    }
  }

  private decorate(fox: InstanceSnapshot): InstanceSnapshot {
    const win = this.windows.get(fox.id)
    return {
      ...fox,
      statusLabel: fox.statusLabel || '',
      poppedOut: win?.poppedOut ?? fox.poppedOut ?? false,
      interacting: win?.interacting ?? fox.interacting ?? false
    }
  }

  private placeholder(id: string): InstanceSnapshot {
    return {
      id,
      url: '',
      host: '',
      title: `Scout ${id}`,
      status: 'loading',
      statusLabel: 'Starting…',
      interacting: false,
      poppedOut: false,
      admittedFlash: false
    }
  }

  private rebuildSnapshots(incoming?: InstanceSnapshot[]): void {
    const byId = new Map(this.snapshots.map((fox) => [fox.id, fox]))
    if (incoming) {
      for (const fox of incoming) byId.set(fox.id, this.decorate(fox))
    }
    this.snapshots = [...this.windows.keys()].map((id) => this.decorate(byId.get(id) ?? this.placeholder(id)))
  }

  private emitAlert(channel: string, id: string, body: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, id)
    }
    if (!this.muted && Notification.isSupported()) {
      new Notification({ title: 'Lair Scout', body }).show()
    }
  }

  private emitNotice(
    channel: string,
    id: string,
    title: string,
    body: string,
    payload: unknown
  ): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
    if (!this.muted && Notification.isSupported()) {
      new Notification({ title: `Lair Scout · ${title}`, body: body.slice(0, 240) }).show()
    }
  }

  private forEachWorker(fn: (handle: WorkerHandle, foxId: string) => void): void {
    for (const [foxId, handle] of this.workers) fn(handle, foxId)
  }

  private input(id: string, cmd: string, payload: Record<string, unknown>): void {
    if (id === '*') {
      this.forEachWorker((handle, foxId) => this.write(handle, { requestId: 0, cmd, foxId, ...payload }))
      return
    }
    this.fireOn(id, cmd, { foxId: id, ...payload })
  }

  private fireOn(foxId: string, cmd: string, payload: Record<string, unknown>): void {
    const handle = this.workers.get(foxId)
    if (!handle) return
    this.write(handle, { requestId: 0, cmd, ...payload })
  }

  private callOn(foxId: string, cmd: string, payload: Record<string, unknown>, timeoutMs = 60000): Promise<unknown> {
    const handle = this.workers.get(foxId)
    if (!handle) return Promise.reject(new Error(`No worker for Scout ${foxId}`))
    const requestId = this.nextRequest++
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { foxId, resolve, reject })
      this.write(handle, { requestId, cmd, foxId, ...payload })
      setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId)
          reject(new Error(`Timed out: ${cmd}`))
        }
      }, timeoutMs)
    })
  }

  private write(handle: WorkerHandle, message: Record<string, unknown>): void {
    handle.child.stdin?.write(`${JSON.stringify(message)}\n`)
  }

  private broadcast(): void {
    const list = this.list()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('instances:update', list)
    }
  }
}

export const scoutManager = new ScoutManager()

function resolveNode(): string {
  const fromNpm = process.env.npm_node_execpath
  if (fromNpm && existsSync(fromNpm)) return fromNpm
  return 'node'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function wordToUInt(value: Buffer | number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0
  if (Buffer.isBuffer(value)) {
    if (value.length >= 8) return Number(value.readBigUInt64LE(0) & 0xffffffffn)
    if (value.length >= 4) return value.readUInt32LE(0)
  }
  return 0
}
