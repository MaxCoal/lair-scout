import type { FoilHint, FullAutoArmInput, FullAutoStatus, ProductCandidate, ShippingProfile } from '@shared/types'
import type { CardSecrets } from './cardVault'
import { needsAiPick, pickLocalMatch, pickWithLlm, productIdFromUrl, scoreHits, type ProductHit } from './productMatch'

export const HOME_URL = 'https://secretlair.wizards.com/us'
const HUNT_MS = 1800
const MAX_TIMEOUT = 2_147_000_000

export function emptyFullAuto(): FullAutoStatus {
  return {
    phase: 'idle',
    productQuery: '',
    foilHint: 'any',
    goLiveAt: 0,
    warmupMinutes: 5,
    fleetSize: 2,
    maxOrders: 1,
    qtyPerOrder: 1,
    matchedTitle: '',
    matchedUrl: '',
    ordersConfirmed: 0,
    candidates: [],
    hasCvv: false
  }
}

export type FullAutoHost = {
  scaleTo: (count: number) => Promise<void>
  workerIds: () => string[]
  callOn: (id: string, cmd: string, payload: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>
  fireOn: (id: string, cmd: string, payload: Record<string, unknown>) => void
  shipping: () => ShippingProfile
  card: () => CardSecrets
}

type Run = {
  input: FullAutoArmInput
  cvv: string
  baselineIds: Set<string>
  claimed: Set<string>
  confirmed: Set<string>
  completing: Set<string>
  huntBusy: boolean
}

export class FullAutoRunner {
  status: FullAutoStatus = emptyFullAuto()
  private run: Run | null = null
  private warmupTimer: NodeJS.Timeout | null = null
  private goLiveTimer: NodeJS.Timeout | null = null
  private huntTimer: NodeJS.Timeout | null = null
  private listeners = new Set<(status: FullAutoStatus) => void>()

  constructor(private host: FullAutoHost) {}

  onStatus(cb: (status: FullAutoStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    const snapshot = { ...this.status, candidates: [...this.status.candidates] }
    for (const cb of this.listeners) cb(snapshot)
  }

  private set(patch: Partial<FullAutoStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit()
  }

  active(): boolean {
    return this.status.phase !== 'idle' && this.status.phase !== 'done' && this.status.phase !== 'aborted' && this.status.phase !== 'error'
  }

  async arm(input: FullAutoArmInput): Promise<FullAutoStatus> {
    const productQuery = String(input.productQuery || '').trim()
    const cvv = String(input.cvv || '').replace(/\s+/g, '')
    const maxOrders = Math.max(1, Math.floor(Number(input.maxOrders) || 1))
    const qtyPerOrder = Math.max(1, Math.floor(Number(input.qtyPerOrder) || 1))
    const warmupMinutes = Math.max(0, Number(input.warmupMinutes) || 0)
    const fleetSize = Math.max(1, Math.min(20, Math.floor(Number(input.fleetSize) || 1)))
    const goLiveAt = Number(input.goLiveAt) || 0
    const foilHint: FoilHint = input.foilHint === 'foil' || input.foilHint === 'nonfoil' ? input.foilHint : 'any'

    if (!productQuery) throw new Error('Enter a product name to search for')
    if (!/^\d{3,4}$/.test(cvv)) throw new Error('CVV is required to arm Full Auto (3–4 digits, not saved)')
    const card = this.host.card()
    if (!card.number || !card.expiry) throw new Error('Save card number and expiry in Settings first')
    const shipping = this.host.shipping()
    if (!shipping.name || !shipping.address) throw new Error('Save name and address in Settings first')
    if (!shipping.email) throw new Error('Save an email in Settings — guest checkout needs it')

    await this.disarm()

    this.run = {
      input: { productQuery, foilHint, goLiveAt, warmupMinutes, fleetSize, maxOrders, qtyPerOrder, cvv },
      cvv,
      baselineIds: new Set(),
      claimed: new Set(),
      confirmed: new Set(),
      completing: new Set(),
      huntBusy: false
    }
    this.set({
      phase: 'armed',
      productQuery,
      foilHint,
      goLiveAt,
      warmupMinutes,
      fleetSize,
      maxOrders,
      qtyPerOrder,
      matchedTitle: '',
      matchedUrl: '',
      ordersConfirmed: 0,
      candidates: [],
      error: undefined,
      hasCvv: true
    })

    const warmupAt = goLiveAt - warmupMinutes * 60_000
    const now = Date.now()
    if (warmupAt <= now) {
      void this.warmup()
    } else {
      this.warmupTimer = setTimeout(() => void this.warmup(), Math.min(MAX_TIMEOUT, warmupAt - now))
    }
    return this.status
  }

  async disarm(): Promise<FullAutoStatus> {
    this.clearTimers()
    const wasActive = this.run != null
    this.run = null
    if (wasActive) {
      await this.abortWorkers()
      this.set({ ...emptyFullAuto(), phase: 'aborted', hasCvv: false })
    } else {
      this.set(emptyFullAuto())
    }
    return this.status
  }

  async shutdown(): Promise<void> {
    this.clearTimers()
    this.run = null
  }

  private clearTimers(): void {
    if (this.warmupTimer) clearTimeout(this.warmupTimer)
    if (this.goLiveTimer) clearTimeout(this.goLiveTimer)
    if (this.huntTimer) clearInterval(this.huntTimer)
    this.warmupTimer = null
    this.goLiveTimer = null
    this.huntTimer = null
  }

  private paymentPayload(): Record<string, unknown> {
    const card = this.host.card()
    const shipping = this.host.shipping()
    return {
      profile: shipping,
      payment: {
        holderName: card.holderName || shipping.name,
        number: card.number,
        expiry: card.expiry,
        cvv: this.run?.cvv || ''
      },
      qtyPerOrder: this.status.qtyPerOrder
    }
  }

  private async pushAutoConfig(): Promise<void> {
    const payload = this.paymentPayload()
    await Promise.all(
      this.host.workerIds().map((id) => this.host.callOn(id, 'setAutoRun', payload).catch(() => undefined))
    )
  }

  private async warmup(): Promise<void> {
    if (!this.run || this.status.phase === 'aborted') return
    this.set({ phase: 'warming', error: undefined })
    try {
      await this.host.scaleTo(this.status.fleetSize)
      await this.pushAutoConfig()
      await Promise.all(
        this.host.workerIds().map((id) =>
          this.host.callOn(id, 'goto', { foxId: id, url: HOME_URL }, 60000).catch(() => undefined)
        )
      )
      await sleep(1200)
      const hits = await this.scrapeAll()
      this.run.baselineIds = new Set(hits.map((hit) => productIdFromUrl(hit.url)))
      const goLiveAt = this.status.goLiveAt
      const delay = goLiveAt - Date.now()
      if (delay <= 0) {
        void this.startHunt()
      } else {
        this.goLiveTimer = setTimeout(() => void this.startHunt(), Math.min(MAX_TIMEOUT, delay))
      }
    } catch (error) {
      this.set({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  private async startHunt(): Promise<void> {
    if (!this.run || this.status.phase === 'aborted' || this.status.matchedUrl) return
    this.set({ phase: 'hunting' })
    for (const id of this.host.workerIds()) {
      this.host.fireOn(id, 'setHunting', { foxId: id })
    }
    await this.huntTick()
    if (this.huntTimer) clearInterval(this.huntTimer)
    this.huntTimer = setInterval(() => void this.huntTick(), HUNT_MS)
  }

  private async scrapeAll(): Promise<ProductHit[]> {
    const results = await Promise.all(
      this.host.workerIds().map((id) =>
        this.host.callOn(id, 'scrapeProducts', { foxId: id }, 20000).catch(() => ({ products: [] }))
      )
    )
    const hits: ProductHit[] = []
    for (const result of results) {
      const products = (result as { products?: ProductHit[] })?.products || []
      hits.push(...products)
    }
    return hits
  }

  private async huntTick(): Promise<void> {
    if (!this.run || this.run.huntBusy || this.status.matchedUrl) return
    if (this.status.phase !== 'hunting') return
    this.run.huntBusy = true
    try {
      const ids = this.host.workerIds()
      if (!ids.length) return
      const hunter = ids[Math.floor(Date.now() / HUNT_MS) % ids.length]
      await this.host.callOn(hunter, 'reload', { foxId: hunter }, 30000).catch(() => undefined)
      await sleep(350)
      const hits = await this.scrapeAll()
      const candidates = scoreHits(this.status.productQuery, this.status.foilHint, hits, this.run.baselineIds)
      this.set({ candidates: candidates.slice(0, 8) })
      let match = pickLocalMatch(candidates)
      if (!match && needsAiPick(candidates)) {
        const key = this.host.card().llmApiKey
        if (key) match = await pickWithLlm(this.status.productQuery, this.status.foilHint, candidates, key)
      }
      if (match) await this.onMatched(match)
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (this.run) this.run.huntBusy = false
    }
  }

  private async onMatched(match: ProductCandidate): Promise<void> {
    if (!this.run || this.status.matchedUrl) return
    if (this.huntTimer) clearInterval(this.huntTimer)
    this.huntTimer = null
    this.set({
      phase: 'matched',
      matchedTitle: match.title,
      matchedUrl: match.url,
      error: undefined
    })
    const ids = this.host.workerIds()
    this.set({ phase: 'rushing' })
    await Promise.allSettled(
      ids.map((id) => this.host.callOn(id, 'goto', { foxId: id, url: match.url }, 60000))
    )
    await Promise.allSettled(
      ids.map((id) => this.host.callOn(id, 'autoRush', { foxId: id, qtyPerOrder: this.status.qtyPerOrder }, 150000))
    )
  }

  async onAdmitted(id: string): Promise<void> {
    if (!this.run) return
    if (this.status.phase === 'aborted' || this.status.phase === 'done') return
    if (this.status.phase === 'rushing' || this.status.phase === 'matched' || this.status.phase === 'hunting') {
      this.set({ phase: 'in_queue' })
    }
    await this.tryComplete(id)
  }

  async onReadyForPayment(id: string): Promise<void> {
    await this.tryComplete(id)
  }

  private claim(id: string): boolean {
    if (!this.run) return false
    if (this.run.confirmed.has(id)) return false
    if (this.run.claimed.has(id)) return true
    if (this.run.claimed.size + this.run.confirmed.size >= this.status.maxOrders) return false
    this.run.claimed.add(id)
    return true
  }

  private release(id: string): void {
    this.run?.claimed.delete(id)
  }

  private async tryComplete(id: string): Promise<void> {
    if (!this.run) return
    if (this.run.completing.has(id) || this.run.confirmed.has(id)) return
    if (this.status.phase === 'aborted' || this.status.phase === 'done') {
      this.host.fireOn(id, 'abortAuto', { foxId: id })
      return
    }
    if (!this.claim(id)) {
      this.host.fireOn(id, 'abortAuto', { foxId: id })
      return
    }
    this.run.completing.add(id)
    this.set({ phase: 'purchasing' })
    try {
      await this.host.callOn(id, 'completeCheckout', { foxId: id }, 180000)
      this.run.claimed.delete(id)
      this.run.confirmed.add(id)
      this.set({ ordersConfirmed: this.run.confirmed.size })
      if (this.run.confirmed.size >= this.status.maxOrders) {
        await this.finish()
      }
    } catch (error) {
      this.release(id)
      this.set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.run?.completing.delete(id)
    }
  }

  private async finish(): Promise<void> {
    this.clearTimers()
    const purchased = this.run?.confirmed || new Set()
    for (const id of this.host.workerIds()) {
      if (!purchased.has(id)) this.host.fireOn(id, 'abortAuto', { foxId: id })
    }
    this.run = null
    this.set({ phase: 'done', hasCvv: false })
  }

  private async abortWorkers(): Promise<void> {
    await Promise.all(
      this.host.workerIds().map((id) => this.host.callOn(id, 'abortAuto', { foxId: id }).catch(() => undefined))
    )
  }

  async onWorkerReady(id: string): Promise<void> {
    if (!this.run || !this.active()) return
    await this.host.callOn(id, 'setAutoRun', this.paymentPayload()).catch(() => undefined)
    if (this.status.matchedUrl) {
      await this.host.callOn(id, 'goto', { foxId: id, url: this.status.matchedUrl }, 60000).catch(() => undefined)
      await this.host.callOn(id, 'autoRush', { foxId: id, qtyPerOrder: this.status.qtyPerOrder }, 150000).catch(() => undefined)
      return
    }
    if (this.status.phase === 'warming' || this.status.phase === 'hunting' || this.status.phase === 'armed') {
      await this.host.callOn(id, 'goto', { foxId: id, url: HOME_URL }, 60000).catch(() => undefined)
      if (this.status.phase === 'hunting') this.host.fireOn(id, 'setHunting', { foxId: id })
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
