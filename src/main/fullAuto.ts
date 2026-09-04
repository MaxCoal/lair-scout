import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { powerSaveBlocker } from 'electron'
import type { FoilHint, FullAutoArmInput, FullAutoStatus, ProductCandidate, ShippingProfile } from '@shared/types'
import { shippingReady } from '@shared/shipping'
import type { CardSecrets } from './cardVault'
import { dataRoot } from './runtimePaths'
import { needsAiPick, pickLocalMatch, pickWithLlm, productIdFromUrl, scoreHits, type ProductHit } from './productMatch'

export const HOME_URL = 'https://secretlair.wizards.com/us'
const HUNT_MS = 1800
const MAX_TIMEOUT = 2_147_000_000
const MAX_CHECKOUT_ATTEMPTS = 4

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
    hasCvv: false,
    debugDumps: false,
    dumpDir: ''
  }
}

export type FullAutoHost = {
  scaleTo: (count: number) => Promise<void>
  workerIds: () => string[]
  callOn: (id: string, cmd: string, payload: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>
  fireOn: (id: string, cmd: string, payload: Record<string, unknown>) => void
  shipping: () => ShippingProfile
  card: () => CardSecrets
  log: (step: string, detail?: string, scoutId?: string) => void
  setDumpDir: (dir: string) => void
  orderConfirmed: (id: string) => void
}

type Run = {
  input: FullAutoArmInput
  cvv: string
  baselineIds: Set<string>
  claimed: Set<string>
  confirmed: Set<string>
  completing: Set<string>
  checkoutAttempts: Map<string, number>
  huntBusy: boolean
}

export class FullAutoRunner {
  status: FullAutoStatus = emptyFullAuto()
  private run: Run | null = null
  private warmupTimer: NodeJS.Timeout | null = null
  private goLiveTimer: NodeJS.Timeout | null = null
  private huntTimer: NodeJS.Timeout | null = null
  private sleepBlocker: number | null = null
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

    const debugDumps = Boolean(input.debugDumps)
    const dumpDir = debugDumps ? makeDumpDir() : ''

    if (!productQuery) throw new Error('Enter a product name to search for')
    if (!/^\d{3,4}$/.test(cvv)) throw new Error('CVV is required to arm Full Auto (3–4 digits, not saved)')
    const card = this.host.card()
    if (!card.number || !card.expiry) throw new Error('Save card number and expiry in Settings first')
    const shipping = this.host.shipping()
    if (!shippingReady(shipping)) throw new Error('Save name, email, and address line 1 in Settings first')

    await this.disarm()

    this.run = {
      input: { productQuery, foilHint, goLiveAt, warmupMinutes, fleetSize, maxOrders, qtyPerOrder, cvv, debugDumps },
      cvv,
      baselineIds: new Set(),
      claimed: new Set(),
      confirmed: new Set(),
      completing: new Set(),
      checkoutAttempts: new Map(),
      huntBusy: false
    }
    this.host.setDumpDir(dumpDir)
    this.host.log('arm', `${productQuery} · fleet ${fleetSize} · max ${maxOrders}`)
    this.blockSleep()
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
      hasCvv: true,
      debugDumps,
      dumpDir
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
    this.unblockSleep()
    const wasActive = this.run != null
    this.run = null
    this.host.setDumpDir('')
    if (wasActive) {
      this.host.log('disarm', 'user stopped Full Auto')
      await this.abortWorkers('disarmed')
      await this.clearWorkerPayment()
      this.set({ ...emptyFullAuto(), phase: 'aborted', hasCvv: false })
    } else {
      this.set(emptyFullAuto())
    }
    return this.status
  }

  async shutdown(): Promise<void> {
    this.clearTimers()
    this.unblockSleep()
    const wasActive = this.run != null
    this.run = null
    if (wasActive) await this.abortWorkers('shutdown')
    await this.clearWorkerPayment()
  }

  private clearTimers(): void {
    if (this.warmupTimer) clearTimeout(this.warmupTimer)
    if (this.goLiveTimer) clearTimeout(this.goLiveTimer)
    if (this.huntTimer) clearInterval(this.huntTimer)
    this.warmupTimer = null
    this.goLiveTimer = null
    this.huntTimer = null
  }

  private blockSleep(): void {
    if (this.sleepBlocker != null) return
    this.sleepBlocker = powerSaveBlocker.start('prevent-app-suspension')
  }

  private unblockSleep(): void {
    if (this.sleepBlocker == null) return
    if (powerSaveBlocker.isStarted(this.sleepBlocker)) powerSaveBlocker.stop(this.sleepBlocker)
    this.sleepBlocker = null
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
      qtyPerOrder: this.status.qtyPerOrder,
      debugDumps: this.status.debugDumps,
      dumpDir: this.status.dumpDir,
      productUrl: this.status.matchedUrl,
      productQuery: this.status.productQuery
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
          this.host.callOn(id, 'goto', { scoutId: id, url: HOME_URL }, 60000).catch(() => undefined)
        )
      )
      await sleep(1200)
      const hits = await this.scrapeAll()
      const goLiveAt = this.status.goLiveAt
      const delay = goLiveAt - Date.now()
      // If go-live is already now, the named drop may already be on the homepage.
      // Keep baseline empty so a live listing is not treated as "old inventory".
      this.run.baselineIds = delay <= 0 ? new Set() : new Set(hits.map((hit) => productIdFromUrl(hit.url)))
      this.host.log(
        'warmup',
        delay <= 0
          ? `go-live is now · ${hits.length} listings on screen`
          : `baseline ${this.run.baselineIds.size} products · hunt in ${Math.ceil(delay / 1000)}s`
      )
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
    this.host.log('hunt', `searching for "${this.status.productQuery}"`)
    for (const id of this.host.workerIds()) {
      this.host.fireOn(id, 'setHunting', { scoutId: id })
    }
    await this.huntTick()
    if (this.huntTimer) clearInterval(this.huntTimer)
    this.huntTimer = setInterval(() => void this.huntTick(), HUNT_MS)
  }

  private async scrapeAll(): Promise<ProductHit[]> {
    const results = await Promise.all(
      this.host.workerIds().map((id) =>
        this.host.callOn(id, 'scrapeProducts', { scoutId: id }, 20000).catch(() => ({ products: [] }))
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
      if (!ids.length) {
        this.host.log('hunt', 'waiting for scouts')
        return
      }
      let match = await this.considerHits('live')
      if (!match && this.run && !this.status.matchedUrl) {
        const hunter = ids[Math.floor(Date.now() / HUNT_MS) % ids.length]
        await this.host.callOn(hunter, 'reload', { scoutId: hunter }, 30000).catch(() => undefined)
        this.host.fireOn(hunter, 'setHunting', { scoutId: hunter })
        await sleep(400)
        match = await this.considerHits('reload')
      }
      if (match) {
        this.host.log('match', `${match.title} (${match.score.toFixed(2)})`)
        await this.onMatched(match)
      }
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (this.run) this.run.huntBusy = false
    }
  }

  private async considerHits(source: string): Promise<ProductCandidate | null> {
    if (!this.run) return null
    const hits = await this.scrapeAll()
    const candidates = scoreHits(this.status.productQuery, this.status.foilHint, hits, this.run.baselineIds)
    this.set({ candidates: candidates.slice(0, 8) })
    let match = pickLocalMatch(candidates)
    if (!match && needsAiPick(candidates)) {
      const key = this.host.card().llmApiKey
      if (key) match = await pickWithLlm(this.status.productQuery, this.status.foilHint, candidates, key)
    }
    const top = candidates[0]
    if (!match) {
      const fresh = candidates.filter((item) => item.isNew).length
      const topBit = top ? `${top.title} ${top.score.toFixed(2)}${top.isNew ? ' new' : ''}` : 'no listings'
      this.host.log('hunt', `${source} · ${topBit} · ${candidates.length} listed · ${fresh} new · no pick`)
    }
    return match
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
    await this.pushAutoConfig()
    const ids = this.host.workerIds()
    this.set({ phase: 'rushing' })
    await Promise.allSettled(
      ids.map((id) => this.host.callOn(id, 'goto', { scoutId: id, url: match.url }, 60000))
    )
    await Promise.allSettled(
      ids.map((id) => this.host.callOn(id, 'autoRush', { scoutId: id, qtyPerOrder: this.status.qtyPerOrder }, 150000))
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
      this.host.log('abort', `phase is ${this.status.phase}`, id)
      this.host.fireOn(id, 'abortAuto', { scoutId: id, reason: `phase ${this.status.phase}` })
      return
    }
    this.run.completing.add(id)
    this.set({ phase: 'purchasing' })
    this.host.log('fill', 'starting checkout fill', id)
    let holdCompleting = false
    try {
      if (this.run.claimed.has(id)) {
        this.host.log('place', 'already claimed — waiting for confirmation', id)
        await this.host.callOn(id, 'placeOrder', { scoutId: id }, 120000)
        if (!this.run) return
        this.run.claimed.delete(id)
        this.run.confirmed.add(id)
        this.host.log('confirmed', `order ${this.run.confirmed.size}/${this.status.maxOrders}`, id)
        this.set({ ordersConfirmed: this.run.confirmed.size, error: undefined })
        this.host.orderConfirmed(id)
        if (this.run.confirmed.size >= this.status.maxOrders) await this.finish()
        return
      }
      await this.host.callOn(id, 'fillCheckout', { scoutId: id }, 120000)
      if (!this.run) return
      if (this.run.confirmed.size >= this.status.maxOrders) {
        this.host.log('abort', 'max orders already confirmed after fill', id)
        this.host.fireOn(id, 'abortAuto', { scoutId: id, reason: 'max orders already confirmed' })
        return
      }
      if (!this.claim(id)) {
        this.host.log('slot', 'no order slot yet — retry fill in 1.5s', id)
        holdCompleting = true
        setTimeout(() => {
          if (!this.run) return
          this.run.completing.delete(id)
          void this.tryComplete(id)
        }, 1500)
        return
      }
      this.host.log('place', 'claimed slot, placing order', id)
      await this.host.callOn(id, 'placeOrder', { scoutId: id }, 120000)
      if (!this.run) return
      this.run.claimed.delete(id)
      this.run.confirmed.add(id)
      this.host.log('confirmed', `order ${this.run.confirmed.size}/${this.status.maxOrders}`, id)
      this.set({ ordersConfirmed: this.run.confirmed.size, error: undefined })
      this.host.orderConfirmed(id)
      if (this.run.confirmed.size >= this.status.maxOrders) {
        await this.finish()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const placedUnconfirmed = /PLACE_UNCONFIRMED/.test(message)
      if (!placedUnconfirmed) this.release(id)
      if (!this.run) return
      if (placedUnconfirmed) {
        this.host.log('ambiguous', 'place clicked but no confirmation — holding slot', id)
        this.set({ error: `Scout ${id}: placed, waiting for confirmation` })
        holdCompleting = true
        setTimeout(() => {
          if (!this.run || this.status.phase === 'done' || this.status.phase === 'aborted') return
          this.run.completing.delete(id)
          void this.tryComplete(id)
        }, 3000)
        return
      }
      const attempts = (this.run.checkoutAttempts.get(id) || 0) + 1
      this.run.checkoutAttempts.set(id, attempts)
      if (attempts >= MAX_CHECKOUT_ATTEMPTS) {
        this.host.log('give-up', `${message} · ${attempts} attempts`, id)
        this.set({ error: `Scout ${id} checkout failed after ${attempts} attempts: ${message}` })
        return
      }
      this.host.log('retry', `${message} · attempt ${attempts}/${MAX_CHECKOUT_ATTEMPTS}`, id)
      this.set({ error: message })
      holdCompleting = true
      setTimeout(() => {
        if (!this.run || this.status.phase === 'done' || this.status.phase === 'aborted') return
        this.run.completing.delete(id)
        void this.tryComplete(id)
      }, 2000)
    } finally {
      if (!holdCompleting) this.run?.completing.delete(id)
    }
  }

  onScoutGone(id: string): void {
    if (!this.run) return
    this.run.claimed.delete(id)
    this.run.completing.delete(id)
    this.run.checkoutAttempts.delete(id)
  }

  async onSoldOut(): Promise<void> {
    if (!this.run || !this.active()) return
    this.host.log('stock', 'sold out notice')
    const busy = new Set([...this.run.claimed, ...this.run.completing, ...this.run.confirmed])
    for (const id of this.host.workerIds()) {
      if (busy.has(id)) continue
      this.host.log('abort', 'sold out', id)
      this.host.fireOn(id, 'abortAuto', { scoutId: id, reason: 'sold out' })
    }
    this.set({ error: 'Sold out — idle scouts aborted' })
    if (!this.run.claimed.size && !this.run.completing.size) {
      if (this.run.confirmed.size > 0) await this.finish()
      else await this.disarm()
      if (this.status.phase === 'aborted') this.set({ error: 'Sold out — stopped' })
    }
  }

  private async finish(): Promise<void> {
    this.clearTimers()
    const purchased = this.run?.confirmed || new Set()
    this.host.log('done', `${purchased.size} order(s) confirmed — aborting remaining scouts`)
    for (const id of this.host.workerIds()) {
      if (!purchased.has(id)) {
        this.host.log('abort', 'max orders confirmed', id)
        this.host.fireOn(id, 'abortAuto', { scoutId: id, reason: 'max orders confirmed' })
      }
    }
    this.run = null
    this.unblockSleep()
    await this.clearWorkerPayment()
    this.set({ phase: 'done', hasCvv: false })
  }

  private async abortWorkers(reason = 'stopped'): Promise<void> {
    await Promise.all(
      this.host.workerIds().map((id) =>
        this.host.callOn(id, 'abortAuto', { scoutId: id, reason }).catch(() => undefined)
      )
    )
  }

  private async clearWorkerPayment(): Promise<void> {
    await Promise.all(
      this.host.workerIds().map((id) =>
        this.host.callOn(id, 'clearPayment', { scoutId: id }).catch(() => undefined)
      )
    )
  }

  async onWorkerReady(id: string): Promise<void> {
    if (!this.run || !this.active()) return
    await this.host.callOn(id, 'setAutoRun', this.paymentPayload()).catch(() => undefined)
    if (this.status.matchedUrl) {
      await this.host.callOn(id, 'goto', { scoutId: id, url: this.status.matchedUrl }, 60000).catch(() => undefined)
      await this.host.callOn(id, 'autoRush', { scoutId: id, qtyPerOrder: this.status.qtyPerOrder }, 150000).catch(() => undefined)
      return
    }
    if (this.status.phase === 'warming' || this.status.phase === 'hunting' || this.status.phase === 'armed') {
      await this.host.callOn(id, 'goto', { scoutId: id, url: HOME_URL }, 60000).catch(() => undefined)
      if (this.status.phase === 'hunting') this.host.fireOn(id, 'setHunting', { scoutId: id })
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeDumpDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(dataRoot(), 'click-dumps', stamp)
  mkdirSync(dir, { recursive: true })
  return dir
}
