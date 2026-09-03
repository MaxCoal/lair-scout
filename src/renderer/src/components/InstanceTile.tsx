import { useRef } from 'react'
import type { InstanceSnapshot } from '@shared/types'
import { StatusChip, statusDetail } from './status'
import { eventCoords, mouseButton, targetId } from '../input'

type Props = {
  fox: InstanceSnapshot
  driveAll: boolean
  onFocus: (id: string) => void
  onGotoOne: (id: string) => void
  onRestart: (id: string) => void
}

export default function InstanceTile({ fox, driveAll, onFocus, onGotoOne, onRestart }: Props) {
  const lastMove = useRef(0)
  const id = targetId(driveAll, fox.id)

  return (
    <article className={`tile ${fox.status} ${fox.admittedFlash ? 'flash' : ''} ${driveAll ? 'herd' : ''}`}>
      {fox.screenshot ? (
        <img
          src={fox.screenshot}
          alt={`Scout ${fox.id}`}
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
            if (!driveAll) onFocus(fox.id)
          }}
          onClick={() => {
            if (!driveAll) onFocus(fox.id)
          }}
        />
      ) : (
        <div className="placeholder" onClick={() => onFocus(fox.id)}>
          Starting Chromium…
        </div>
      )}
      <div className="tile-overlay">
        <div>
          <div style={{ fontWeight: 600 }}>Scout {fox.id}</div>
          {statusDetail(fox) ? <div className="mono">{statusDetail(fox)}</div> : null}
        </div>
        <div className="tile-actions">
          <StatusChip instance={fox} />
          <button
            className="btn primary"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onFocus(fox.id)
            }}
          >
            Interact
          </button>
          <button
            className="btn"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onGotoOne(fox.id)
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
              onRestart(fox.id)
            }}
          >
            Restart
          </button>
        </div>
      </div>
    </article>
  )
}
