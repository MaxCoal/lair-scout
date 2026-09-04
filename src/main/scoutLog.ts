import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import type { ScoutLogEntry } from '@shared/types'

const MAX_MEMORY = 160
const memory: ScoutLogEntry[] = []
let dumpDir = ''

export function setScoutDumpDir(dir: string): void {
  dumpDir = String(dir || '')
}

export function scoutLogDir(): string {
  const root = app.isPackaged ? app.getPath('userData') : process.cwd()
  return join(root, 'scout-logs')
}

export function scoutLogPath(): string {
  return join(scoutLogDir(), 'actions.log')
}

export function formatScoutLog(entry: ScoutLogEntry): string {
  const when = new Date(entry.at).toISOString()
  const who = entry.scoutId ? `scout ${entry.scoutId}` : 'auto'
  const detail = entry.detail ? `  ${entry.detail.replace(/\s+/g, ' ').trim()}` : ''
  const url = entry.url ? `  ${entry.url}` : ''
  return `${when}  [${who}]  ${entry.step}${detail}${url}`
}

export function recentScoutLogs(): ScoutLogEntry[] {
  return [...memory]
}

export function appendScoutLog(partial: Partial<ScoutLogEntry> & { step: string }): ScoutLogEntry {
  const entry: ScoutLogEntry = {
    at: Number(partial.at) || Date.now(),
    scoutId: String(partial.scoutId || ''),
    step: String(partial.step || ''),
    detail: String(partial.detail || ''),
    url: String(partial.url || '')
  }
  memory.push(entry)
  if (memory.length > MAX_MEMORY) memory.shift()
  const line = `${formatScoutLog(entry)}\n`
  try {
    mkdirSync(scoutLogDir(), { recursive: true })
    appendFileSync(scoutLogPath(), line, 'utf8')
    if (dumpDir) {
      mkdirSync(dumpDir, { recursive: true })
      appendFileSync(join(dumpDir, 'actions.log'), line, 'utf8')
    }
  } catch {
    /* keep in-memory even if disk write fails */
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('scout:log', entry)
  }
  return entry
}
