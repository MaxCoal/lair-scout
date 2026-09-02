import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { ShippingProfile } from '@shared/types'

const empty = (): ShippingProfile => ({ name: '', address: '' })

export function settingsPath(): string {
  const root = app.isPackaged ? app.getPath('userData') : process.cwd()
  return join(root, 'settings.json')
}

export async function loadSettings(): Promise<ShippingProfile> {
  const path = settingsPath()
  if (!existsSync(path)) return empty()
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<ShippingProfile>
    return {
      name: String(raw.name || ''),
      address: String(raw.address || '')
    }
  } catch {
    return empty()
  }
}

export async function saveSettings(profile: ShippingProfile): Promise<ShippingProfile> {
  const next: ShippingProfile = {
    name: String(profile.name || '').trim(),
    address: String(profile.address || '').trim()
  }
  await writeFile(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}
