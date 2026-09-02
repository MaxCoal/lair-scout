import type { FormEvent } from 'react'

type Props = {
  url: string
  count: number
  muted: boolean
  onUrl: (value: string) => void
  onSendAll: (event: FormEvent) => void
  onSpawn: () => void
  onKillLast: () => void
  onToggleMute: () => void
}

export default function FleetBar({
  url,
  count,
  muted,
  onUrl,
  onSendAll,
  onSpawn,
  onKillLast,
  onToggleMute
}: Props) {
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
        <div className="stepper">
          <button className="btn" type="button" onClick={onKillLast} disabled={count === 0}>
            −
          </button>
          <span className="mono">{count}</span>
          <button className="btn" type="button" onClick={onSpawn}>
            +
          </button>
        </div>
        <button className={`btn ghost ${muted ? 'active' : ''}`} type="button" onClick={onToggleMute}>
          {muted ? 'Alerts off' : 'Alerts on'}
        </button>
      </div>
    </header>
  )
}
