import { BrowserWindow, Notification, app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { InstanceSnapshot } from '@shared/types'
import { findWindowByTitle, hideWindow, showWindow } from './win32'

const DEFAULT_COUNT = 2

type WindowState = {
  hwnd: number
  poppedOut: boolean
}

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
        throw new Error('Firefox worker did not start. Is Node.js on PATH?')
      })
    ])
    for (let i = 0; i < DEFAULT_COUNT; i += 1) {
      await this.spawn()
    }
  }

  async spawn(): Promise<string> {
    await this.ready
    const id = String(this.nextId++)
    const profileDir = join(app.getPath('userData'), 'foxes', id)
    await this.call('spawn', { foxId: id, profileDir })
    let hwnd = 0
    for (let attempt = 0; attempt < 12 && !hwnd; attempt += 1) {
      hwnd = await findWindowByTitle(`FoxBox-${id}`)
      if (!hwnd) await sleep(250)
    }
    if (hwnd) await hideWindow(hwnd)
    this.windows.set(id, { hwnd, poppedOut: false })
    this.broadcast()
    return id
  }

  async kill(id: string): Promise<void> {
    await this.call('kill', { foxId: id })
    this.windows.delete(id)
    this.broadcast()
  }

  async gotoAll(url: string): Promise<void> {
    await this.call('gotoAll', { url })
  }

  async gotoOne(id: string, url: string): Promise<void> {
    await this.call('goto', { foxId: id, url })
  }

  async reload(id: string): Promise<void> {
    await this.call('reload', { foxId: id })
  }

  async click(
    id: string,
    nx: number,
    ny: number,
    button: 'left' | 'right' | 'middle' = 'left',
    double = false
  ): Promise<void> {
    await this.call('click', { foxId: id, nx, ny, button, double })
  }

  async move(id: string, nx: number, ny: number): Promise<void> {
    await this.call('move', { foxId: id, nx, ny })
  }

  async key(id: string, key: string, type: 'down' | 'up' | 'press'): Promise<void> {
    await this.call('key', { foxId: id, key, keyType: type })
  }

  async scroll(id: string, dx: number, dy: number): Promise<void> {
    await this.call('scroll', { foxId: id, dx, dy })
  }

  async popOut(id: string): Promise<void> {
    const state = this.windows.get(id)
    if (!state) return
    if (state.hwnd) await showWindow(state.hwnd)
    state.poppedOut = true
    this.broadcast()
  }

  async dock(id: string): Promise<void> {
    const state = this.windows.get(id)
    if (!state) return
    if (state.hwnd) await hideWindow(state.hwnd)
    state.poppedOut = false
    this.broadcast()
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    try {
      await this.call('shutdown', {})
    } catch {
      /* worker may already be gone */
    }
    this.worker?.kill()
    this.worker = null
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
        pending.reject(new Error(`Firefox worker exited (${code ?? 'unknown'})`))
        this.pending.delete(id)
      }
      if (!this.shuttingDown) {
        console.error('Firefox worker exited unexpectedly', code)
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
          poppedOut: win?.poppedOut ?? false
        }
      })
      this.broadcast()
      return
    }

    if (message.type === 'event' && message.event === 'admitted') {
      const id = String(message.payload)
      this.window?.webContents.send('instances:admitted', id)
      if (!this.muted && Notification.isSupported()) {
        new Notification({
          title: 'FoxBox',
          body: `Fox ${id} is through the queue`
        }).show()
      }
    }
  }

  private call(cmd: string, payload: Record<string, unknown>): Promise<unknown> {
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
      }, 60000)
    })
  }

  private broadcast(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send('instances:update', this.list())
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
