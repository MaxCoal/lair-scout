import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

function scriptPath(): string {
  return join(__dirname, 'win32.ps1')
}

export async function controlWindow(opts: {
  action: 'find' | 'hide' | 'show'
  title?: string
  hwnd?: number
}): Promise<number> {
  const args = [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath(),
    '-Action',
    opts.action,
    '-Handle',
    String(opts.hwnd ?? 0)
  ]
  if (opts.title) {
    args.push('-Title', opts.title)
  }

  try {
    const { stdout } = await execFileAsync('powershell.exe', args, {
      windowsHide: true,
      timeout: 12000
    })
    const value = Number.parseInt(String(stdout).trim(), 10)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

export async function findWindowByTitle(title: string): Promise<number> {
  return controlWindow({ action: 'find', title })
}

export async function hideWindow(hwnd: number): Promise<number> {
  return controlWindow({ action: 'hide', hwnd })
}

export async function showWindow(hwnd: number): Promise<number> {
  return controlWindow({ action: 'show', hwnd })
}
