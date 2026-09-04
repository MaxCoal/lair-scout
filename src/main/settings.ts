import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettings, SettingsUpdate, ThemeId } from '@shared/types'
import { emptyShipping, normalizeShipping } from '@shared/shipping'
import { loadCardVault, looksMasked, saveCardVault, type CardSecrets } from './cardVault'
import { dataRoot } from './runtimePaths'

export function emptySettings(): AppSettings {
  return {
    ...emptyShipping(),
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
  return join(dataRoot(), 'settings.json')
}

function publicSettings(
  shipping: ReturnType<typeof normalizeShipping> & { theme: ThemeId },
  card: CardSecrets
): AppSettings {
  return {
    ...shipping,
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
  if (!existsSync(path)) return publicSettings({ ...emptyShipping(), theme: 'dungeon' }, card)
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<SettingsUpdate> & { theme?: ThemeId }
    return publicSettings(
      {
        ...normalizeShipping(raw),
        theme: parseTheme(raw.theme)
      },
      card
    )
  } catch {
    return publicSettings({ ...emptySettings(), theme: 'dungeon' }, card)
  }
}

export async function saveSettings(update: SettingsUpdate): Promise<AppSettings> {
  const shipping = {
    ...normalizeShipping(update),
    theme: parseTheme(update.theme)
  }
  await writeFile(settingsPath(), `${JSON.stringify(shipping, null, 2)}\n`, 'utf8')

  const current = await loadCardVault()
  const typedNumber = String(update.cardNumber || '').trim()
  const nextCard: CardSecrets = update.clearCard
    ? {
        holderName: String(update.cardHolderName ?? current.holderName).trim() || shipping.name,
        number: '',
        expiry: '',
        last4: '',
        llmApiKey:
          update.llmApiKey == null || update.llmApiKey === ''
            ? current.llmApiKey
            : String(update.llmApiKey).trim()
      }
    : {
        holderName: String(update.cardHolderName ?? current.holderName).trim() || shipping.name,
        number: typedNumber && !looksMasked(typedNumber) ? typedNumber.replace(/\s+/g, '') : current.number,
        expiry: String(update.cardExpiry ?? current.expiry).trim() || current.expiry,
        last4: current.last4,
        llmApiKey:
          update.llmApiKey == null || update.llmApiKey === ''
            ? current.llmApiKey
            : String(update.llmApiKey).trim()
      }
  if (update.clearCard || nextCard.number || nextCard.llmApiKey || nextCard.expiry) {
    await saveCardVault(nextCard)
  }
  const saved = await loadCardVault()
  return publicSettings(shipping, saved)
}
