import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppSettings, ShippingProfile, ThemeId } from '@shared/types'

export function emptyShipping(): ShippingProfile {
  return {
    email: '',
    firstName: '',
    lastName: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zip: ''
  }
}

export function emptySettings(): AppSettings {
  return { ...emptyShipping(), theme: 'dungeon' }
}

function parseTheme(value: unknown): ThemeId {
  return value === 'daylight' ? 'daylight' : 'dungeon'
}

function splitName(name: string): { firstName: string; lastName: string } {
  const bits = name.trim().split(/\s+/).filter(Boolean)
  return { firstName: bits[0] || '', lastName: bits.slice(1).join(' ') }
}

function splitAddress(raw: string): Pick<ShippingProfile, 'address1' | 'address2' | 'city' | 'state' | 'zip'> {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const last = lines[lines.length - 1] || ''
  const cityStateZip =
    last.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/) ||
    last.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/)
  if (cityStateZip) {
    const address1 =
      lines.length === 1
        ? last.slice(0, last.length - cityStateZip[0].length).replace(/,\s*$/, '').trim()
        : lines[0] || ''
    return {
      address1,
      address2: lines.length > 2 ? lines.slice(1, -1).join(', ') : '',
      city: cityStateZip[1].replace(/,\s*$/, '').trim(),
      state: cityStateZip[2].toUpperCase(),
      zip: cityStateZip[3]
    }
  }
  return {
    address1: lines[0] || raw.trim(),
    address2: lines.slice(1).join(', '),
    city: '',
    state: '',
    zip: ''
  }
}

export function normalizeShipping(raw: Partial<ShippingProfile> & { name?: string; address?: string }): ShippingProfile {
  const fromName = splitName(String(raw.name || ''))
  const fromAddress = splitAddress(String(raw.address || ''))
  const state = String(raw.state || fromAddress.state || '')
    .trim()
    .toUpperCase()
    .slice(0, 2)
  return {
    email: String(raw.email || '').trim(),
    firstName: String(raw.firstName || fromName.firstName || '').trim(),
    lastName: String(raw.lastName || fromName.lastName || '').trim(),
    address1: String(raw.address1 || fromAddress.address1 || '').trim(),
    address2: String(raw.address2 || fromAddress.address2 || '').trim(),
    city: String(raw.city || fromAddress.city || '').trim(),
    state,
    zip: String(raw.zip || fromAddress.zip || '').trim()
  }
}

export function settingsPath(): string {
  const root = app.isPackaged ? app.getPath('userData') : process.cwd()
  return join(root, 'settings.json')
}

export async function loadSettings(): Promise<AppSettings> {
  const path = settingsPath()
  if (!existsSync(path)) return emptySettings()
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<AppSettings> & {
      name?: string
      address?: string
    }
    return { ...normalizeShipping(raw), theme: parseTheme(raw.theme) }
  } catch {
    return emptySettings()
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const next: AppSettings = {
    ...normalizeShipping(settings),
    theme: parseTheme(settings.theme)
  }
  await writeFile(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}
