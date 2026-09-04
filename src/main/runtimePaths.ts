import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function packagedRuntimeDir(): string | undefined {
  if (!app.isPackaged) return undefined
  const dir = join(process.resourcesPath, 'runtime')
  return existsSync(dir) ? dir : undefined
}

export function workerScriptPath(): string {
  const runtime = packagedRuntimeDir()
  if (runtime) return join(runtime, 'scoutWorker.cjs')
  const src = join(process.cwd(), 'src/main/scoutWorker.cjs')
  if (existsSync(src)) return src
  return join(__dirname, 'scoutWorker.cjs')
}

export function resolveNodePath(): string {
  const runtime = packagedRuntimeDir()
  if (runtime) {
    const bundled = join(runtime, process.platform === 'win32' ? 'node.exe' : 'node')
    if (existsSync(bundled)) return bundled
  }
  const fromNpm = process.env.npm_node_execpath
  if (fromNpm && existsSync(fromNpm)) return fromNpm
  return process.platform === 'win32' ? 'node.exe' : 'node'
}

export function win32HostPath(): string {
  const runtime = packagedRuntimeDir()
  if (runtime) return join(runtime, 'win32-host.ps1')
  return join(__dirname, 'win32-host.ps1')
}

export function playwrightBrowsersPath(): string | undefined {
  const runtime = packagedRuntimeDir()
  if (!runtime) return undefined
  const browsers = join(runtime, 'browsers')
  return existsSync(browsers) ? browsers : undefined
}
