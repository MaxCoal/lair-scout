import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppSettings, SettingsUpdate, ThemeId } from '@shared/types'
import { emptyCard, loadCardVault, looksMasked, saveCardVault, type CardSecrets } from './cardVault'

export function emptySettings(): AppSettings {
  return {
    name: '',
    address: '',
    phone: '',
    email: '',
    theme: 'dungeon',
    cardHolderName: '',
    cardLast4: '',
    cardExpiry: '',
    hasCard: false,
    hasLlmKey: false
  }
}

function parseTheme(value: unknown): ThemeId {
  return value === 'daylight' ? 'daylight' : 'dungeon'
}

export function settingsPath(): string {
  const root = app.isPackaged ? app.getPath('userData') : process.cwd()
  return join(root, 'settings.json')
}

function publicSettings(
  shipping: { name: string; address: string; phone: string; email: string; theme: ThemeId },
  card: CardSecrets
): AppSettings {
  return {
    name: shipping.name,
    address: shipping.address,
    phone: shipping.phone,
    email: shipping.email,
    theme: shipping.theme,
    cardHolderName: card.holderName,
    cardLast4: card.last4,
    cardExpiry: card.expiry,
    hasCard: Boolean(card.number && card.expiry),
    hasLlmKey: Boolean(card.llmApiKey)
  }
}

export async function loadSettings(): Promise<AppSettings> {
  const path = settingsPath()
  const card = await loadCardVault()
  if (!existsSync(path)) return publicSettings(emptySettings(), card)
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<AppSettings>
    return publicSettings(
      {
        name: String(raw.name || ''),
        address: String(raw.address || ''),
        phone: String(raw.phone || ''),
        email: String(raw.email || ''),
        theme: parseTheme(raw.theme)
      },
      card
    )
  } catch {
    return publicSettings(emptySettings(), card)
  }
}

export async function saveSettings(update: SettingsUpdate): Promise<AppSettings> {
  const shipping = {
    name: String(update.name || '').trim(),
    address: String(update.address || '').trim(),
    phone: String(update.phone || '').trim(),
    email: String(update.email || '').trim(),
    theme: parseTheme(update.theme)
  }
  await writeFile(settingsPath(), `${JSON.stringify(shipping, null, 2)}\n`, 'utf8')

  const current = await loadCardVault()
  const typedNumber = String(update.cardNumber || '').trim()
  const nextCard: CardSecrets = {
    holderName: String(update.cardHolderName ?? current.holderName).trim() || shipping.name,
    number: typedNumber && !looksMasked(typedNumber) ? typedNumber.replace(/\s+/g, '') : current.number,
    expiry: String(update.cardExpiry ?? current.expiry).trim() || current.expiry,
    last4: current.last4,
    llmApiKey:
      update.llmApiKey == null || update.llmApiKey === ''
        ? current.llmApiKey
        : String(update.llmApiKey).trim()
  }
  if (nextCard.number || nextCard.llmApiKey || nextCard.expiry) {
    await saveCardVault(nextCard)
  }
  const saved = await loadCardVault()
  return publicSettings(shipping, saved)
}
