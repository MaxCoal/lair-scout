import type { ShippingProfile } from './types'

export function emptyShipping(): ShippingProfile {
  return {
    name: '',
    firstName: '',
    lastName: '',
    email: '',
    address: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
    country: 'US',
    phone: ''
  }
}

export function splitPersonName(name: string): { firstName: string; lastName: string } {
  const bits = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return { firstName: bits[0] || '', lastName: bits.slice(1).join(' ') }
}

export function composePersonName(firstName: string, lastName: string, fallback = ''): string {
  return `${firstName} ${lastName}`.trim() || fallback
}

export function parseAddressBlob(address: string): Pick<ShippingProfile, 'address1' | 'address2' | 'city' | 'state' | 'zip'> {
  const lines = String(address || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  let address1 = lines[0] || ''
  let address2 = ''
  let city = ''
  let state = ''
  let zip = ''
  const last = lines[lines.length - 1] || ''
  const streetCityStateZip = last.match(/^(.+?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/)
  const cityStateZip = last.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/)
  if (streetCityStateZip && lines.length === 1) {
    address1 = streetCityStateZip[1].trim()
    city = streetCityStateZip[2].trim()
    state = streetCityStateZip[3].toUpperCase()
    zip = streetCityStateZip[4]
  } else if (cityStateZip) {
    city = cityStateZip[1]
    state = cityStateZip[2].toUpperCase()
    zip = cityStateZip[3]
    if (lines.length === 1) {
      address1 = last.slice(0, last.length - cityStateZip[0].length).replace(/,\s*$/, '').trim()
    } else {
      address1 = lines[0]
      address2 = lines
        .slice(1, -1)
        .filter((line) => line.toLowerCase() !== address1.toLowerCase())
        .join(', ')
    }
  } else if (lines.length > 1) {
    address2 = lines
      .slice(1)
      .filter((line) => line.toLowerCase() !== address1.toLowerCase())
      .join(', ')
  }
  return { address1, address2, city, state, zip }
}

export function composeAddressBlob(parts: {
  address1?: string
  address2?: string
  city?: string
  state?: string
  zip?: string
}): string {
  const cityLine = [parts.city, [parts.state, parts.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [parts.address1, parts.address2, cityLine]
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join('\n')
}

export function normalizeCountry(value: string): string {
  const raw = String(value || '').trim()
  if (!raw || /^united states|usa?$/i.test(raw)) return 'US'
  return raw.length === 2 ? raw.toUpperCase() : raw
}

export function normalizeShipping(raw: Partial<ShippingProfile> | null | undefined): ShippingProfile {
  const src = raw || {}
  const parsed = parseAddressBlob(String(src.address || ''))
  const names = splitPersonName(String(src.name || ''))
  const firstName = String(src.firstName || names.firstName).trim()
  const lastName = String(src.lastName || names.lastName).trim()
  const address1 = String(src.address1 || parsed.address1).trim()
  let address2 = String(src.address2 ?? parsed.address2).trim()
  if (address2 && address2.toLowerCase() === address1.toLowerCase()) address2 = ''
  const city = String(src.city || parsed.city).trim()
  const state = String(src.state || parsed.state).trim().toUpperCase()
  const zip = String(src.zip || parsed.zip).trim()
  const country = normalizeCountry(String(src.country || 'US'))
  const name = composePersonName(firstName, lastName, String(src.name || '').trim())
  return {
    name,
    firstName,
    lastName,
    email: String(src.email || '').trim(),
    address1,
    address2,
    city,
    state,
    zip,
    country,
    address: composeAddressBlob({ address1, address2, city, state, zip }),
    phone: String(src.phone || '').trim()
  }
}

export function shippingReady(profile: ShippingProfile): boolean {
  const ship = normalizeShipping(profile)
  return Boolean((ship.name || ship.firstName) && (ship.address1 || ship.address) && ship.email)
}
