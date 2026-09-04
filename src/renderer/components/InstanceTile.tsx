import { useRef } from 'react'
import type { InstanceSnapshot } from '@shared/types'
import { StatusChip, statusDetail } from './status'
import { eventCoords, mouseButton, targetId } from '../input'
import { useAdmittedTimer } from '../useAdmittedTimer'

type Props = {
  instance: InstanceSnapshot
  driveAll: boolean
  onFocus: (id: string) => void
  onGotoOne: (id: string) => void
  onRestart: (id: string) => void
}

export default function InstanceTile({ instance, driveAll, onFocus, onGotoOne, onRestart }: Props) {
  const lastMove = useRef(0)
  const id = targetId(driveAll, instance.id)
  const countdown = useAdmittedTimer(instance)

  return (
    <article className={`tile ${instance.status} ${instance.admittedFlash ? 'flash' : ''} ${driveAll ? 'herd' : ''}`}>
      {instance.screenshot ? (
        <img
          src={instance.screenshot}
          alt={`Scout ${instance.id}`}
          onMouseMove={(event) => {
            if (!driveAll) return
            const now = Date.now()
            if (now - lastMove.current < 32) return
            lastMove.current = now
            const point = eventCoords(event)
            if (point) void window.lairscout.move({ id, ...point })
          }}
          onMouseDown={(event) => {
            if (!driveAll) return
            const point = eventCoords(event)
            if (!point) return
            event.preventDefault()
            void window.lairscout.click({
              id,
              ...point,
              button: mouseButton(event),
              double: event.detail === 2
            })
          }}
          onWheel={(event) => {
            if (!driveAll) return
            event.preventDefault()
            event.stopPropagation()
            void window.lairscout.scroll({ id, dx: event.deltaX, dy: event.deltaY })
          }}
          onContextMenu={(event) => event.preventDefault()}
          onDoubleClick={() => {
            if (!driveAll) onFocus(instance.id)
          }}
          onClick={() => {
            if (!driveAll) onFocus(instance.id)
          }}
        />
      ) : (
        <div className="placeholder" onClick={() => onFocus(instance.id)}>
          Starting Chromium…
        </div>
      )}
      <div className="tile-overlay">
        <div>
          <div style={{ fontWeight: 600 }}>
            Scout {instance.id}
            {instance.unhealthy ? <span className="badge-unhealthy" title="Scout may be stalled — will auto-restart">⚠</span> : null}
          </div>
          {countdown ? <div className="mono countdown">{countdown}</div> : null}
          {!countdown && statusDetail(instance) ? <div className="mono">{statusDetail(instance)}</div> : null}
        </div>
        <div className="tile-actions">
          <StatusChip instance={instance} />
          <button
            className="btn primary"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onFocus(instance.id)
            }}
          >
            Interact
          </button>
          <button
            className="btn"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onGotoOne(instance.id)
            }}
          >
            Send
          </button>
          <button
            className="btn"
            type="button"
            title="New browser session (drops queue)"
            onClick={(event) => {
              event.stopPropagation()
              onRestart(instance.id)
            }}
          >
            Restart
          </button>
        </div>
      </div>
    </article>
  )
}
