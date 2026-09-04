import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { dataRoot } from './runtimePaths'

export type CardSecrets = {
  holderName: string
  number: string
  expiry: string
  last4: string
  llmApiKey: string
}

type VaultFile = {
  holderName?: string
  last4?: string
  expiry?: string
  panCipher?: string
  expiryCipher?: string
  llmKeyCipher?: string
}

export function emptyCard(): CardSecrets {
  return { holderName: '', number: '', expiry: '', last4: '', llmApiKey: '' }
}

export function vaultPath(): string {
  return join(dataRoot(), 'card.vault.json')
}

function encrypt(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows encryption is unavailable; card details were not saved')
  }
  return safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    console.error('card vault: Windows encryption is unavailable')
    return ''
  }
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch (error) {
    console.error('card vault decrypt failed', error)
    return ''
  }
}

function last4Of(number: string): string {
  const digits = number.replace(/\D/g, '')
  return digits.slice(-4)
}

export function maskCardNumber(last4: string): string {
  if (!last4) return ''
  return `•••• •••• •••• ${last4}`
}

export function looksMasked(number: string): boolean {
  return /•|x{4,}/i.test(number) || !/\d{12,}/.test(number.replace(/\s/g, ''))
}

export async function loadCardVault(): Promise<CardSecrets> {
  const path = vaultPath()
  if (!existsSync(path)) return emptyCard()
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as VaultFile
    const number = decrypt(String(raw.panCipher || ''))
    const expiry = decrypt(String(raw.expiryCipher || '')) || String(raw.expiry || '')
    const llmApiKey = decrypt(String(raw.llmKeyCipher || ''))
    if (raw.panCipher && !number) {
      console.error('card vault: stored card could not be decrypted')
    }
    return {
      holderName: String(raw.holderName || ''),
      number,
      expiry,
      last4: String(raw.last4 || last4Of(number)),
      llmApiKey
    }
  } catch (error) {
    console.error('card vault load failed', error)
    return emptyCard()
  }
}

export async function saveCardVault(secrets: CardSecrets): Promise<CardSecrets> {
  const next: CardSecrets = {
    holderName: String(secrets.holderName || '').trim(),
    number: String(secrets.number || '').replace(/\s+/g, ''),
    expiry: String(secrets.expiry || '').trim(),
    last4: last4Of(secrets.number) || String(secrets.last4 || ''),
    llmApiKey: String(secrets.llmApiKey || '').trim()
  }
  const file: VaultFile = {
    holderName: next.holderName,
    last4: next.last4,
    panCipher: encrypt(next.number),
    expiryCipher: encrypt(next.expiry),
    llmKeyCipher: encrypt(next.llmApiKey)
  }
  await writeFile(vaultPath(), `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  return next
}
