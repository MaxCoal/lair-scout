import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { FoilHint, FullAutoStatus, ScoutLogEntry } from '@shared/types'
import { normalizeShipping } from '@shared/shipping'

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
  const [debugDumps, setDebugDumps] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [logs, setLogs] = useState<ScoutLogEntry[]>([])
  const [logPath, setLogPath] = useState('')
  const [logOpen, setLogOpen] = useState(false)
  const logEnd = useRef<HTMLDivElement | null>(null)

  const armed = status.phase !== 'idle' && status.phase !== 'aborted' && status.phase !== 'done' && status.phase !== 'error'

  useEffect(() => {
    void window.lairscout.getScoutLogs().then((bundle) => {
      setLogs(bundle.lines)
      setLogPath(bundle.path)
    })
    return window.lairscout.onScoutLog((entry) => {
      setLogs((prev) => [...prev.slice(-140), entry])
    })
  }, [])

  useEffect(() => {
    if (!logOpen) return
    logEnd.current?.scrollIntoView({ block: 'end' })
  }, [logs, logOpen])

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
        cvv,
        debugDumps
      })
      .then(() => setCvv(''))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }

  const onTestCard = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const settings = await window.lairscout.getSettings()
      const ship = normalizeShipping(settings)
      await window.lairscout.saveSettings({
        ...ship,
        firstName: ship.firstName || 'Test',
        lastName: ship.lastName || 'Buyer',
        name: ship.name || 'Test Buyer',
        email: ship.email || 'test@example.com',
        address1: ship.address1 || '123 Test St',
        city: ship.city || 'Springfield',
        state: ship.state || 'IL',
        zip: ship.zip || '62701',
        country: ship.country || 'US',
        phone: ship.phone || '5550100',
        theme: settings.theme,
        cardHolderName: settings.cardHolderName || ship.name || 'Test Buyer',
        cardNumber: '4242424242424242',
        cardExpiry: '12/30'
      })
      setCvv('123')
      setDebugDumps(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
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
            <>
              <button className="btn ghost" type="button" onClick={() => void onTestCard()} disabled={busy}>
                Test card
              </button>
              <button className="btn rush" type="submit" disabled={busy || fleetSize === 0}>
                {busy ? 'Arming…' : 'Arm'}
              </button>
            </>
          )}
        </div>
      </div>
      <label className="auto-dump">
        <input
          type="checkbox"
          checked={debugDumps || status.debugDumps}
          onChange={(event) => setDebugDumps(event.target.checked)}
          disabled={armed}
        />
        Save page HTML at each click (testing)
      </label>
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
        Keep this PC awake. Scouts warm up before go-live, then search the store for the name. Remaining scouts abort
        only after max orders confirm.
        {status.dumpDir ? ` Page dumps: ${status.dumpDir}` : ''}
      </p>
      <div className="auto-log">
        <button
          className="auto-log-head"
          type="button"
          aria-expanded={logOpen}
          onClick={() => setLogOpen((open) => !open)}
        >
          <span>
            Scout actions
            {logs.length ? ` · ${logs.length}` : ''}
          </span>
          <span className="auto-log-toggle">{logOpen ? 'Hide' : 'Show'}</span>
        </button>
        {logOpen ? (
          <pre className="auto-log-body">
            {logs.length
              ? logs
                  .slice(-80)
                  .map((entry) => {
                    const time = new Date(entry.at).toLocaleTimeString()
                    const who = entry.foxId ? `S${entry.foxId}` : 'auto'
                    return `${time}  ${who}  ${entry.step}${entry.detail ? `  ${entry.detail}` : ''}`
                  })
                  .join('\n')
              : `Actions show up here when you Arm. Same lines are written to ${logPath || 'scout-logs/actions.log'}.`}
            <div ref={logEnd} />
          </pre>
        ) : null}
      </div>
    </form>
  )
}
