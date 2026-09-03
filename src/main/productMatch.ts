import type { FoilHint, ProductCandidate } from '@shared/types'

export type ProductHit = {
  url: string
  title: string
}

const MIN_SCORE = 0.42
const WEAK_NEW_SCORE = 0.2
const CLOSE_DELTA = 0.12

export function normalizeProductUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.hash = ''
    url.search = ''
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return String(raw || '').trim()
  }
}

export function productIdFromUrl(url: string): string {
  const match = url.match(/\/product\/(\d+)/i)
  return match?.[1] || url
}

function stripNoise(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/secret\s+lair\s+x\s+/g, ' ')
    .replace(/secret\s+lair/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(value: string): string[] {
  return stripNoise(value).split(' ').filter((part) => part.length > 1)
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (a === b) return 0
  if (!m) return n
  if (!n) return m
  const row = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) row[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = i - 1
    row[0] = i
    for (let j = 1; j <= n; j++) {
      const cur = row[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = cur
    }
  }
  return row[n]
}

function titleHasFoil(title: string): boolean {
  return /\bfoil\b/i.test(title) && !/\bnon[-\s]?foil\b/i.test(title)
}

function foilBonus(query: string, title: string, hint: FoilHint): number {
  const queryFoil = /\bfoil\b/i.test(query) && !/\bnon[-\s]?foil\b/i.test(query)
  const queryNon = /\bnon[-\s]?foil\b/i.test(query)
  const hasFoil = titleHasFoil(title)
  if (hint === 'foil' || queryFoil) return hasFoil ? 0.18 : -0.2
  if (hint === 'nonfoil' || queryNon) return hasFoil ? -0.2 : 0.12
  return 0
}

export function scoreProduct(query: string, title: string, foilHint: FoilHint): number {
  const q = stripNoise(query)
  const t = stripNoise(title)
  if (!q || !t) return 0
  const qTokens = tokens(query)
  const tSet = new Set(tokens(title))
  const overlap = qTokens.length ? qTokens.filter((tok) => tSet.has(tok)).length / qTokens.length : 0
  const maxLen = Math.max(q.length, t.length)
  const ratio = maxLen ? 1 - levenshtein(q, t) / maxLen : 0
  const includes = t.includes(q) || q.includes(t) ? 1 : 0
  const base = overlap * 0.5 + ratio * 0.3 + includes * 0.2
  return Math.max(0, Math.min(1, base + foilBonus(query, title, foilHint)))
}

export function scoreHits(
  query: string,
  foilHint: FoilHint,
  hits: ProductHit[],
  baselineIds: Set<string>
): ProductCandidate[] {
  const byId = new Map<string, ProductCandidate>()
  for (const hit of hits) {
    const url = normalizeProductUrl(hit.url)
    if (!/\/product\/\d+/i.test(url)) continue
    const id = productIdFromUrl(url)
    const title = String(hit.title || '').replace(/\s+/g, ' ').trim() || id
    const scored: ProductCandidate = {
      url,
      title,
      score: scoreProduct(query, title, foilHint),
      isNew: !baselineIds.has(id)
    }
    const prev = byId.get(id)
    if (!prev || scored.score > prev.score || scored.title.length > prev.title.length) {
      byId.set(id, scored)
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score || Number(b.isNew) - Number(a.isNew))
}

export function pickLocalMatch(candidates: ProductCandidate[]): ProductCandidate | null {
  if (!candidates.length) return null
  const fresh = candidates.filter((item) => item.isNew)
  const pool = fresh.length ? fresh : candidates
  const best = pool[0]
  const second = pool[1]
  if (fresh.length === 1 && best.score >= WEAK_NEW_SCORE) return best
  if (best.score < MIN_SCORE) return null
  if (second && best.score - second.score < CLOSE_DELTA && second.score >= MIN_SCORE - 0.05) return null
  return best
}

export function needsAiPick(candidates: ProductCandidate[]): boolean {
  const fresh = candidates.filter((item) => item.isNew)
  const pool = fresh.length ? fresh : candidates
  if (pool.length < 2) return false
  const best = pool[0]
  const second = pool[1]
  if (!best || !second) return false
  if (best.score < WEAK_NEW_SCORE) return false
  return best.score - second.score < CLOSE_DELTA
}

export async function pickWithLlm(
  query: string,
  foilHint: FoilHint,
  candidates: ProductCandidate[],
  apiKey: string
): Promise<ProductCandidate | null> {
  const pool = (candidates.filter((item) => item.isNew).length
    ? candidates.filter((item) => item.isNew)
    : candidates
  ).slice(0, 8)
  if (!apiKey || pool.length === 0) return pickLocalMatch(candidates)
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Pick the single Secret Lair product that best matches the shopper query. Reply with the exact URL only, or NONE.'
          },
          {
            role: 'user',
            content: [
              `Query: ${query}`,
              `Foil hint: ${foilHint}`,
              'Candidates:',
              ...pool.map((item) => `${item.url} | ${item.title} | score ${item.score.toFixed(2)}${item.isNew ? ' | NEW' : ''}`)
            ].join('\n')
          }
        ]
      })
    })
    if (!response.ok) return pickLocalMatch(candidates)
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const text = String(body.choices?.[0]?.message?.content || '').trim()
    const picked = pool.find((item) => text.includes(item.url))
    return picked || pickLocalMatch(candidates)
  } catch {
    return pickLocalMatch(candidates)
  }
}
