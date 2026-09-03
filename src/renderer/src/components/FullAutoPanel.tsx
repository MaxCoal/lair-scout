import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { FoilHint, FullAutoStatus } from '@shared/types'

type Props = {
  fleetSize: number
  status: FullAutoStatus
}

const PHASE_COPY: Record<FullAutoStatus['phase'], string> = {
  idle: 'Idle',
  armed: 'Armed — waiting for warmup',
  warming: 'Warming browsers',
  hunting: 'Hunting for the drop',
  matched: 'Matched product',
  rushing: 'Adding to cart',
  in_queue: 'In queue',
  purchasing: 'Purchasing',
  done: 'Done',
  aborted: 'Aborted',
  error: 'Error'
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toLocalInput(ms: number): string {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): number {
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function defaultGoLive(): string {
  return toLocalInput(Date.now() + 10 * 60 * 1000)
}

export default function FullAutoPanel({ fleetSize, status }: Props) {
  const [productQuery, setProductQuery] = useState('')
  const [foilHint, setFoilHint] = useState<FoilHint>('any')
  const [goLive, setGoLive] = useState(defaultGoLive)
  const [warmupMinutes, setWarmupMinutes] = useState('5')
  const [maxOrders, setMaxOrders] = useState('1')
  const [qtyPerOrder, setQtyPerOrder] = useState('1')
  const [cvv, setCvv] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const armed = status.phase !== 'idle' && status.phase !== 'aborted' && status.phase !== 'done' && status.phase !== 'error'

  useEffect(() => {
    if (!armed) return undefined
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [armed])

  useEffect(() => {
    if (!status.productQuery) return
    setProductQuery(status.productQuery)
    setFoilHint(status.foilHint)
    if (status.goLiveAt) setGoLive(toLocalInput(status.goLiveAt))
    setWarmupMinutes(String(status.warmupMinutes))
    setMaxOrders(String(status.maxOrders))
    setQtyPerOrder(String(status.qtyPerOrder))
  }, [status.productQuery, status.foilHint, status.goLiveAt, status.warmupMinutes, status.maxOrders, status.qtyPerOrder])

  const countdown = useMemo(() => {
    if (!armed || !status.goLiveAt) return ''
    const delta = status.goLiveAt - now
    if (delta <= 0) return 'Go-live is now'
    const total = Math.ceil(delta / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `Go-live in ${h}h ${m}m`
    if (m > 0) return `Go-live in ${m}m ${s}s`
    return `Go-live in ${s}s`
  }, [armed, status.goLiveAt, now])

  const onArm = (event: FormEvent): void => {
    event.preventDefault()
    setBusy(true)
    setError('')
    void window.lairscout
      .armFullAuto({
        productQuery,
        foilHint,
        goLiveAt: fromLocalInput(goLive),
        warmupMinutes: Number.parseInt(warmupMinutes, 10) || 0,
        fleetSize,
        maxOrders: Number.parseInt(maxOrders, 10) || 1,
        qtyPerOrder: Number.parseInt(qtyPerOrder, 10) || 1,
        cvv
      })
      .then(() => setCvv(''))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }

  const onDisarm = (): void => {
    setBusy(true)
    setError('')
    void window.lairscout
      .disarmFullAuto()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }

  return (
    <form className="auto-bar" onSubmit={onArm}>
      <div className="auto-grid">
        <label className="field">
          <span>Product name</span>
          <input
            value={productQuery}
            onChange={(event) => setProductQuery(event.target.value)}
            placeholder="e.g. Black Panther Foil"
            disabled={armed}
          />
        </label>
        <label className="field">
          <span>Edition</span>
          <select
            value={foilHint}
            onChange={(event) => setFoilHint(event.target.value as FoilHint)}
            disabled={armed}
          >
            <option value="any">Any</option>
            <option value="foil">Foil</option>
            <option value="nonfoil">Non-foil</option>
          </select>
        </label>
        <label className="field">
          <span>Go live</span>
          <input type="datetime-local" value={goLive} onChange={(event) => setGoLive(event.target.value)} disabled={armed} />
        </label>
        <label className="field">
          <span>Warmup (min)</span>
          <input
            inputMode="numeric"
            value={warmupMinutes}
            onChange={(event) => setWarmupMinutes(event.target.value.replace(/[^\d]/g, ''))}
            disabled={armed}
          />
        </label>
        <label className="field">
          <span>Max orders</span>
          <input
            inputMode="numeric"
            value={maxOrders}
            onChange={(event) => setMaxOrders(event.target.value.replace(/[^\d]/g, ''))}
            disabled={armed}
            title="Fleet-wide successful purchases, then remaining scouts abort"
          />
        </label>
        <label className="field">
          <span>Qty / order</span>
          <input
            inputMode="numeric"
            value={qtyPerOrder}
            onChange={(event) => setQtyPerOrder(event.target.value.replace(/[^\d]/g, ''))}
            disabled={armed}
          />
        </label>
        <label className="field">
          <span>CVV</span>
          <input
            value={cvv}
            onChange={(event) => setCvv(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            placeholder={status.hasCvv ? 'Armed' : 'Not saved'}
            inputMode="numeric"
            autoComplete="off"
            disabled={armed}
          />
        </label>
        <div className="auto-actions">
          {armed ? (
            <button className="btn" type="button" onClick={onDisarm} disabled={busy}>
              Disarm
            </button>
          ) : (
            <button className="btn rush" type="submit" disabled={busy || fleetSize === 0}>
              {busy ? 'Arming…' : 'Arm'}
            </button>
          )}
        </div>
      </div>
      <div className="auto-status">
        <span className={`chip ${status.phase === 'done' ? 'purchased' : status.phase}`}>
          {PHASE_COPY[status.phase]}
        </span>
        {countdown ? <span className="mono">{countdown}</span> : null}
        <span>
          Orders {status.ordersConfirmed}/{status.maxOrders || 1}
        </span>
        {status.matchedTitle ? <strong>Matched: {status.matchedTitle}</strong> : null}
        {status.error ? <span className="hint">{status.error}</span> : null}
        {error ? <span className="hint">{error}</span> : null}
      </div>
      {status.candidates.length ? (
        <div className="auto-candidates">
          {status.candidates.slice(0, 4).map((item) => (
            <span key={item.url} className="mono" title={item.url}>
              {item.isNew ? 'New · ' : ''}
              {item.title} ({item.score.toFixed(2)})
            </span>
          ))}
        </div>
      ) : null}
      <p className="auto-note">
        Keep this PC awake. Scouts warm up before go-live, then search the store for the name. Remaining scouts abort as
        soon as max orders confirm.
      </p>
    </form>
  )
}
