import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { RamSnapshot } from '@shared/types'

type Props = {
  url: string
  count: number
  ram: RamSnapshot | null
  muted: boolean
  driveAll: boolean
  onUrl: (value: string) => void
  onSendAll: (event: FormEvent) => void
  onScaleTo: (count: number) => void
  onToggleMute: () => void
  onToggleDriveAll: () => void
  onOpenDriveWindow: () => void
}

export default function FleetBar({
  url,
  count,
  ram,
  muted,
  driveAll,
  onUrl,
  onSendAll,
  onScaleTo,
  onToggleMute,
  onToggleDriveAll,
  onOpenDriveWindow
}: Props) {
  const [draft, setDraft] = useState(String(count))
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setDraft(String(count))
  }, [count])

  const applyDraft = (): void => {
    editing.current = false
    const next = Number.parseInt(draft, 10)
    if (!Number.isFinite(next)) {
      setDraft(String(count))
      return
    }
    onScaleTo(next)
  }

  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <path fill="#f97316" d="M6 8l6-4 4 5 4-5 6 4-2 8c0 7-4 12-8 12s-8-5-8-12L6 8z" />
          <circle cx="13" cy="14" r="1.4" fill="#0b0c0f" />
          <circle cx="19" cy="14" r="1.4" fill="#0b0c0f" />
        </svg>
        <div className="brand-name">
          Fox<span>Box</span>
        </div>
      </div>
      <form className="nav-form" onSubmit={onSendAll}>
        <input
          value={url}
          onChange={(event) => onUrl(event.target.value)}
          spellCheck={false}
          placeholder="https://secretlair.wizards.com/us"
        />
        <button className="btn primary" type="submit">
          Send all
        </button>
      </form>
      <div className="top-actions">
        <form
          className="stepper"
          onSubmit={(event) => {
            event.preventDefault()
            applyDraft()
          }}
        >
          <button className="btn" type="button" onClick={() => onScaleTo(count - 1)} disabled={count === 0}>
            −
          </button>
          <input
            className="count-input mono"
            value={draft}
            inputMode="numeric"
            aria-label="Fleet size"
            title="Type a count and press Enter"
            onFocus={() => {
              editing.current = true
            }}
            onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
            onBlur={applyDraft}
          />
          <button className="btn" type="button" onClick={() => onScaleTo(count + 1)}>
            +
          </button>
        </form>
        {ram ? (
          <div
            className={`ram-meter ${ram.percent >= 90 ? 'critical' : ram.percent >= 75 ? 'warn' : ''}`}
            title={`System ${ram.usedLabel} of ${ram.totalLabel} in use. FoxBox is using ${ram.foxboxLabel}.`}
          >
            <div className="ram-bar" style={{ width: `${Math.min(100, ram.percent)}%` }} />
            <span className="mono">
              RAM {ram.usedLabel} / {ram.totalLabel} · FoxBox {ram.foxboxLabel}
            </span>
          </div>
        ) : null}
        <button className={`btn ghost ${driveAll ? 'active' : ''}`} type="button" onClick={onToggleDriveAll}>
          Drive all
        </button>
        {driveAll ? (
          <button className="btn" type="button" onClick={onOpenDriveWindow}>
            Drive window
          </button>
        ) : null}
        <button className={`btn ghost ${muted ? 'active' : ''}`} type="button" onClick={onToggleMute}>
          {muted ? 'Alerts off' : 'Alerts on'}
        </button>
      </div>
    </header>
  )
}
