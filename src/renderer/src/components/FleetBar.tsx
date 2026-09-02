import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { RamSnapshot } from '@shared/types'
import { instanceSortLabel, type InstanceSort } from '../sortInstances'

function tone(percent: number): string {
  if (percent >= 90) return 'critical'
  if (percent >= 75) return 'warn'
  return ''
}

type Props = {
  url: string
  count: number
  ram: RamSnapshot | null
  muted: boolean
  driveAll: boolean
  onUrl: (value: string) => void
  onSendAll: (event: FormEvent) => void
  onRushCheckout: () => void
  rushing: boolean
  onScaleTo: (count: number) => void
  onToggleMute: () => void
  onToggleDriveAll: () => void
  onOpenDriveWindow: () => void
  onOpenSettings: () => void
  instanceSort: InstanceSort
  onCycleInstanceSort: () => void
}

export default function FleetBar({
  url,
  count,
  ram,
  muted,
  driveAll,
  onUrl,
  onSendAll,
  onRushCheckout,
  rushing,
  onScaleTo,
  onToggleMute,
  onToggleDriveAll,
  onOpenDriveWindow,
  onOpenSettings,
  instanceSort,
  onCycleInstanceSort
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
      <div className="top-row">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path
              fill="#c9a36a"
              d="M16 3.5l3.2 8.2 8.8.6-6.8 5.4 2.2 8.5L16 21.6 8.6 26.2l2.2-8.5-6.8-5.4 8.8-.6z"
            />
            <circle cx="16" cy="16" r="3.2" fill="#0b0c0f" />
          </svg>
          <div className="brand-name">
            Lair<span>Scout</span>
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
          <button
            className="btn rush"
            type="button"
            disabled={rushing || count === 0}
            title="Add to cart, proceed to checkout, continue as guest, wait in queue"
            onClick={onRushCheckout}
          >
            {rushing ? 'Rushing…' : 'Cart & queue'}
          </button>
        </form>
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
      </div>
      <div className="top-row tools">
        {ram ? (
          <div
            className={`ram-meter combined ${tone(Math.max(ram.cpuPercent, ram.gpuPercent ?? 0, ram.percent))}`}
            title={[
              `CPU ${ram.cpuPercent}% (Lair Scout ~${ram.cpuScoutPercent}% of all cores)`,
              ram.gpuPercent == null
                ? 'GPU hardware acceleration on'
                : `GPU ${ram.gpuPercent}%${ram.gpuName ? ` · ${ram.gpuName}` : ''}`,
              `RAM ${ram.usedLabel} / ${ram.totalLabel} · Lair Scout ${ram.scoutLabel}`
            ].join('\n')}
          >
            <div
              className="ram-bar"
              style={{ width: `${Math.min(100, Math.max(ram.cpuPercent, ram.gpuPercent ?? 0, ram.percent))}%` }}
            />
            <span className="mono">
              CPU {ram.cpuPercent}%
              <i />
              GPU {ram.gpuPercent == null ? '…' : `${ram.gpuPercent}%`}
              <i />
              RAM {ram.usedLabel}/{ram.totalLabel}
            </span>
          </div>
        ) : null}
        <div className="top-actions">
          <button className={`btn ghost ${driveAll ? 'active' : ''}`} type="button" onClick={onToggleDriveAll}>
            Drive all
          </button>
          <button
            className={`btn ghost ${instanceSort !== 'id' ? 'active' : ''}`}
            type="button"
            title="Sort by remaining queue time"
            onClick={onCycleInstanceSort}
          >
            {instanceSortLabel(instanceSort)}
          </button>
          {driveAll ? (
            <button className="btn" type="button" onClick={onOpenDriveWindow}>
              Drive window
            </button>
          ) : null}
          <button className="btn ghost" type="button" onClick={onOpenSettings}>
            Settings
          </button>
          <button className={`btn ghost ${muted ? '' : 'alerts-on'}`} type="button" onClick={onToggleMute}>
            {muted ? 'Alerts off' : 'Alerts on'}
          </button>
        </div>
      </div>
    </header>
  )
}
