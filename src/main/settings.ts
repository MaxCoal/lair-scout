import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppSettings, ThemeId } from '@shared/types'

export function emptySettings(): AppSettings {
  return { name: '', address: '', phone: '', theme: 'dungeon' }
}

function parseTheme(value: unknown): ThemeId {
  return value === 'daylight' ? 'daylight' : 'dungeon'
}

export function settingsPath(): string {
  const root = app.isPackaged ? app.getPath('userData') : process.cwd()
  return join(root, 'settings.json')
}

export async function loadSettings(): Promise<AppSettings> {
  const path = settingsPath()
  if (!existsSync(path)) return emptySettings()
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<AppSettings>
    return {
      name: String(raw.name || ''),
      address: String(raw.address || ''),
      phone: String(raw.phone || ''),
      theme: parseTheme(raw.theme)
    }
  } catch {
    return emptySettings()
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const next: AppSettings = {
    name: String(settings.name || '').trim(),
    address: String(settings.address || '').trim(),
    phone: String(settings.phone || '').trim(),
    theme: parseTheme(settings.theme)
  }
  await writeFile(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}
