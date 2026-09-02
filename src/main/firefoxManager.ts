import { BrowserWindow, Notification, app, screen } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { InstanceSnapshot, RamSnapshot } from '@shared/types'
import { findFoxWindow, hideFoxWindow, placeFoxWindow, showWindow, stopWin32Host } from './win32'
import { readRam } from './memory'

const DEFAULT_COUNT = 2
const MAX_FLEET = 20

type WindowState = {
  hwnd: number
  pid: number
  profileDir: string
  poppedOut: boolean
  interacting: boolean
}

type StageRect = { x: number; y: number; width: number; height: number }

export class FirefoxManager {
  private window: BrowserWindow | null = null
  private worker: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private nextRequest = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private snapshots: InstanceSnapshot[] = []
  private windows = new Map<string, WindowState>()
  private muted = false
  private shuttingDown = false
  private dockTimer: NodeJS.Timeout | null = null
  private interactTimer: NodeJS.Timeout | null = null
  private ramTimer: NodeJS.Timeout | null = null
  private stageRect: StageRect | null = null
  private ready: Promise<void>
  private markReady: () => void = () => undefined

  constructor() {
    this.ready = new Promise((resolve) => {
      this.markReady = resolve
    })
  }

  attach(window: BrowserWindow): void {
    this.window = window
    this.ensureWorker()
    this.armDockTimer()
    this.armInteractTimer()
    this.armRamTimer()
    window.on('move', () => {
      void this.relayoutInteract()
    })
    window.on('resize', () => {
      void this.relayoutInteract()
    })
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  async setFocused(id: string | null): Promise<void> {
    await this.call('setFocused', { foxId: id })
  }

  list(): InstanceSnapshot[] {
    return this.snapshots
  }

  async startDefaultFleet(): Promise<void> {
    await Promise.race([
      this.ready,
      sleep(20000).then(() => {
        throw new Error('Chromium worker did not start. Is Node.js on PATH?')
      })
    ])
    for (let i = 0; i < DEFAULT_COUNT; i += 1) {
      await this.spawn()
    }
  }

  async spawn(): Promise<string> {
    await this.ready
    return this.launch(String(this.nextId++))
  }

  async restart(id: string): Promise<void> {
    await this.ready
    const snap = this.snapshots.find((fox) => fox.id === id)
    const url = snap?.url && /^https?:/i.test(snap.url) ? snap.url : undefined
    const state = this.windows.get(id)
    if (state?.interacting) {
      state.interacting = false
      this.fire('setPaused', { foxId: id, paused: false })
    }
    if (this.windows.has(id)) {
      await this.call('kill', { foxId: id }).catch(() => undefined)
      this.windows.delete(id)
      this.broadcast()
    }
    await this.launch(id)
    if (url) await this.gotoOne(id, url)
  }

  private async launch(id: string): Promise<string> {
    const profileDir = join(app.getPath('userData'), 'foxes', `${id}-${Date.now()}`)
    this.windows.set(id, { hwnd: 0, pid: 0, profileDir, poppedOut: false, interacting: false })
    const result = (await this.call('spawn', { foxId: id, profileDir }, 120000)) as { pid?: number }
    const state = this.windows.get(id)
    if (state && result?.pid) state.pid = result.pid
    if (state) {
      state.hwnd = await hideFoxWindow({
        pid: state.pid,
        hwnd: state.hwnd,
        title: `FoxBox-${id}`,
        owner: this.ownerHwnd()
      })
    }
    this.broadcast()
    return id
  }

  async scaleTo(target: number): Promise<void> {
    const n = Math.max(0, Math.min(MAX_FLEET, Math.floor(Number(target) || 0)))
    while (this.windows.size < n) {
      await this.spawn()
    }
    while (this.windows.size > n) {
      const last = [...this.windows.keys()].at(-1)
      if (!last) break
      await this.kill(last)
    }
  }

  async kill(id: string): Promise<void> {
    await this.call('kill', { foxId: id })
    this.windows.delete(id)
    this.broadcast()
  }

  async gotoAll(url: string): Promise<void> {
    await this.call('gotoAll', { url })
  }

  async rushCheckout(): Promise<void> {
    await this.call('rushCheckout', {}, 150000)
  }

  async gotoOne(id: string, url: string): Promise<void> {
    await this.call('goto', { foxId: id, url })
  }

  async reload(id: string): Promise<void> {
    await this.call('reload', { foxId: id })
  }

  click(
    id: string,
    nx: number,
    ny: number,
    button: 'left' | 'right' | 'middle' = 'left',
    double = false
  ): void {
    this.fire('click', { foxId: id, nx, ny, button, double })
  }

  move(id: string, nx: number, ny: number): void {
    this.fire('move', { foxId: id, nx, ny })
  }

  key(id: string, key: string, type: 'down' | 'up' | 'press'): void {
    this.fire('key', { foxId: id, key, keyType: type })
  }

  scroll(id: string, dx: number, dy: number): void {
    this.fire('scroll', { foxId: id, dx, dy })
  }

  async interact(id: string, rect: StageRect): Promise<void> {
    this.stageRect = rect
    this.fire('setPaused', { foxId: id, paused: true })
    for (const [otherId, other] of this.windows) {
      if (otherId !== id && other.interacting) {
        other.interacting = false
        await hideFoxWindow({
          pid: other.pid,
          hwnd: other.hwnd,
          title: `FoxBox-${otherId}`,
          owner: this.ownerHwnd()
        })
      }
    }
    const state = this.windows.get(id)
    if (!state) return
    state.interacting = true
    state.poppedOut = false
    const placed = await this.placeState(id, state, rect)
    if (placed) state.hwnd = placed
    this.broadcast()
  }

  async stopInteract(id: string): Promise<void> {
    const state = this.windows.get(id)
    if (!state) return
    state.interacting = false
    state.hwnd = await hideFoxWindow({
      pid: state.pid,
      hwnd: state.hwnd,
      title: `FoxBox-${id}`,
      owner: this.ownerHwnd()
    })
    this.fire('setPaused', { foxId: id, paused: false })
    this.broadcast()
  }

  async popOut(id: string): Promise<void> {
    const state = this.windows.get(id)
    if (!state) return
    state.interacting = false
    const hwnd = await findFoxWindow({ pid: state.pid, hwnd: state.hwnd, title: `FoxBox-${id}` })
    if (hwnd) state.hwnd = hwnd
    if (state.hwnd) await showWindow(state.hwnd)
    state.poppedOut = true
    this.fire('setPaused', { foxId: id, paused: true })
    this.broadcast()
  }

  async dock(id: string): Promise<void> {
    const state = this.windows.get(id)
    if (!state) return
    state.interacting = false
    state.poppedOut = false
    state.hwnd = await hideFoxWindow({
      pid: state.pid,
      hwnd: state.hwnd,
      title: `FoxBox-${id}`,
      owner: this.ownerHwnd()
    })
    this.fire('setPaused', { foxId: id, paused: false })
    this.broadcast()
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.dockTimer) clearInterval(this.dockTimer)
    if (this.interactTimer) clearInterval(this.interactTimer)
    if (this.ramTimer) clearInterval(this.ramTimer)
    try {
      await this.call('shutdown', {})
    } catch {
      /* worker may already be gone */
    }
    this.worker?.kill()
    this.worker = null
    stopWin32Host()
  }

  private async placeState(id: string, state: WindowState, rect: StageRect): Promise<number> {
    if (!this.window || this.window.isDestroyed()) return 0
    const content = this.window.getContentBounds()
    const dip = {
      x: content.x + rect.x,
      y: content.y + rect.y,
      width: Math.max(100, rect.width),
      height: Math.max(80, rect.height)
    }
    const phys = screen.dipToScreenRect(this.window, dip)
    return placeFoxWindow(
      { pid: state.pid, hwnd: state.hwnd, title: `FoxBox-${id}`, owner: this.ownerHwnd() },
      phys
    )
  }

  private ownerHwnd(): number {
    if (!this.window || this.window.isDestroyed()) return 0
    const buf = this.window.getNativeWindowHandle()
    return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0)
  }

  private async relayoutInteract(): Promise<void> {
    if (!this.stageRect) return
    for (const [id, state] of this.windows) {
      if (!state.interacting) continue
      const hwnd = await this.placeState(id, state, this.stageRect)
      if (hwnd) state.hwnd = hwnd
    }
  }

  private armRamTimer(): void {
    if (this.ramTimer) return
    const tick = (): void => {
      if (this.shuttingDown) return
      const pids = [process.pid, this.worker?.pid ?? 0]
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

  private armInteractTimer(): void {
    if (this.interactTimer) return
    this.interactTimer = setInterval(() => {
      if (this.shuttingDown) return
      void this.relayoutInteract()
    }, 80)
  }

  private armDockTimer(): void {
    if (this.dockTimer) return
    this.dockTimer = setInterval(() => {
      if (this.shuttingDown) return
      for (const [id, state] of this.windows) {
        if (state.poppedOut || state.interacting) continue
        void hideFoxWindow({
          pid: state.pid,
          hwnd: state.hwnd,
          title: `FoxBox-${id}`,
          owner: this.ownerHwnd()
        }).then((hwnd) => {
          if (hwnd) state.hwnd = hwnd
        })
      }
    }, 2000)
  }

  private ensureWorker(): void {
    if (this.worker) return
    const workerPath = join(__dirname, 'foxWorker.cjs')
    const nodePath = resolveNode()
    const env = { ...process.env }
    delete env.PLAYWRIGHT_BROWSERS_PATH
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(nodePath, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true
    })
    this.worker = child

    child.stderr.on('data', (chunk) => {
      console.error('[fox-worker]', String(chunk))
    })

    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => this.onLine(line))
    child.on('exit', (code) => {
      for (const [id, pending] of this.pending) {
        pending.reject(new Error(`Chromium worker exited (${code ?? 'unknown'})`))
        this.pending.delete(id)
      }
      if (!this.shuttingDown) {
        console.error('Chromium worker exited unexpectedly', code)
      }
    })
  }

  private onLine(line: string): void {
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
      console.error('[fox-worker] bad line', line)
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
        void hideFoxWindow({
          pid: state.pid,
          hwnd: state.hwnd,
          title: `FoxBox-${payload.foxId}`,
          owner: this.ownerHwnd()
        }).then((hwnd) => {
          if (hwnd) state.hwnd = hwnd
        })
      }
      return
    }

    if (message.type === 'event' && message.event === 'ready') {
      this.markReady()
      return
    }

    if (message.type === 'event' && message.event === 'update') {
      const incoming = (message.payload as InstanceSnapshot[]) || []
      this.snapshots = incoming.map((fox) => {
        const win = this.windows.get(fox.id)
        return {
          ...fox,
          statusLabel: fox.statusLabel || '',
          poppedOut: win?.poppedOut ?? false,
          interacting: win?.interacting ?? false
        }
      })
      this.broadcast()
      return
    }

    if (message.type === 'event' && message.event === 'admitted') {
      const id = String(message.payload)
      this.emitAlert('instances:admitted', id, `Fox ${id} is through the queue`)
      return
    }

    if (message.type === 'event' && message.event === 'queuePopped') {
      const id = String(message.payload)
      this.emitAlert('instances:queuePopped', id, `Fox ${id}: queue started`)
      return
    }
  }

  private emitAlert(channel: string, id: string, body: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, id)
    }
    if (!this.muted && Notification.isSupported()) {
      new Notification({ title: 'FoxBox', body }).show()
    }
  }

  private fire(cmd: string, payload: Record<string, unknown>): void {
    this.ensureWorker()
    this.worker?.stdin.write(`${JSON.stringify({ requestId: 0, cmd, ...payload })}\n`)
  }

  private call(cmd: string, payload: Record<string, unknown>, timeoutMs = 60000): Promise<unknown> {
    this.ensureWorker()
    const requestId = this.nextRequest++
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.worker?.stdin.write(`${JSON.stringify({ requestId, cmd, ...payload })}\n`)
      setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId)
          reject(new Error(`Timed out: ${cmd}`))
        }
      }, timeoutMs)
    })
  }

  private broadcast(): void {
    const list = this.list()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('instances:update', list)
    }
  }
}

export const firefoxManager = new FirefoxManager()

function resolveNode(): string {
  const fromNpm = process.env.npm_node_execpath
  if (fromNpm && existsSync(fromNpm)) return fromNpm
  return 'node'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
