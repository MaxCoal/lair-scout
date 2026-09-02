import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

export type Win32Opts = {
  action: 'find' | 'hide' | 'show' | 'place'
  title?: string
  hwnd?: number
  pid?: number
  owner?: number
  topmost?: boolean
  taskbar?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
}

class Win32Host {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private queue: Array<{
    resolve: (value: number) => void
    reject: (error: Error) => void
  }> = []

  async send(opts: Win32Opts): Promise<number> {
    await this.ensure()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.queue.findIndex((item) => item.resolve === resolve)
        if (index >= 0) this.queue.splice(index, 1)
        resolve(0)
      }, 8000)
      this.queue.push({
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject
      })
      this.proc?.stdin.write(
        `${JSON.stringify({
          action: opts.action,
          handle: opts.hwnd ?? 0,
          pid: opts.pid ?? 0,
          owner: opts.owner ?? 0,
          topmost: Boolean(opts.topmost),
          taskbar: Boolean(opts.taskbar),
          title: opts.title ?? '',
          x: Math.round(opts.x ?? 0),
          y: Math.round(opts.y ?? 0),
          width: Math.round(opts.width ?? 1280),
          height: Math.round(opts.height ?? 720)
        })}\n`
      )
    })
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
    this.ready = null
    this.queue = []
  }

  private ensure(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise((resolve, reject) => {
      const script = join(__dirname, 'win32-host.ps1')
      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      )
      this.proc = proc
      proc.stderr.on('data', (chunk) => {
        console.error('[win32-host]', String(chunk))
      })
      const rl = createInterface({ input: proc.stdout })
      let started = false
      rl.on('line', (line) => {
        const text = line.trim()
        if (!started) {
          if (text === 'READY') {
            started = true
            resolve()
          }
          return
        }
        const next = this.queue.shift()
        if (!next) return
        const value = Number.parseInt(text, 10)
        next.resolve(Number.isFinite(value) ? value : 0)
      })
      proc.on('exit', () => {
        this.proc = null
        this.ready = null
        for (const item of this.queue) item.resolve(0)
        this.queue = []
        if (!started) reject(new Error('win32 host exited'))
      })
    })
    return this.ready
  }
}

const host = new Win32Host()

export async function controlWindow(opts: Win32Opts): Promise<number> {
  try {
    return await host.send(opts)
  } catch {
    return 0
  }
}

export async function hideFoxWindow(
  opts: { pid?: number; hwnd?: number; title?: string; owner?: number }
): Promise<number> {
  return controlWindow({ action: 'hide', taskbar: false, topmost: false, ...opts })
}

export async function findFoxWindow(opts: { pid?: number; hwnd?: number; title?: string }): Promise<number> {
  return controlWindow({ action: 'find', ...opts })
}

export async function showWindow(hwnd: number): Promise<number> {
  return controlWindow({ action: 'show', hwnd, taskbar: true, topmost: false, owner: 0 })
}

export async function placeFoxWindow(
  opts: { pid?: number; hwnd?: number; title?: string; owner?: number },
  rect: { x: number; y: number; width: number; height: number }
): Promise<number> {
  return controlWindow({ action: 'place', taskbar: false, topmost: true, ...opts, ...rect })
}

export function stopWin32Host(): void {
  host.stop()
}
