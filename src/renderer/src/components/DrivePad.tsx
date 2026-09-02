import { useRef } from 'react'
import type { InstanceSnapshot } from '@shared/types'
import { StatusChip, statusLine } from './status'
import { eventCoords, mouseButton } from '../input'

type Props = {
  fox: InstanceSnapshot | null
  fleetCount: number
  standalone?: boolean
}

export default function DrivePad({ fox, fleetCount, standalone = false }: Props) {
  const lastMove = useRef(0)

  if (!fox) {
    return <div className="placeholder">Spawn a fox to drive the herd.</div>
  }

  return (
    <div className={`drive-pad ${standalone ? 'standalone' : ''}`}>
      <div className="focus-bar">
        <div>
          <strong>Drive all · showing Fox {fox.id}</strong>
          <div className="mono">
            Clicks, scroll, and keys go to {fleetCount} fox{fleetCount === 1 ? '' : 'es'} · {statusLine(fox)}
          </div>
        </div>
        <StatusChip status={fox.status} />
      </div>
      <div
        className="focus-stage herd"
        onWheel={(event) => {
          event.preventDefault()
          void window.foxbox.scroll({ id: '*', dx: event.deltaX, dy: event.deltaY })
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {fox.screenshot ? (
          <img
            src={fox.screenshot}
            alt={`Drive view of Fox ${fox.id}`}
            onMouseMove={(event) => {
              const now = Date.now()
              if (now - lastMove.current < 32) return
              lastMove.current = now
              const point = eventCoords(event)
              if (point) window.foxbox.move({ id: '*', ...point })
            }}
            onMouseDown={(event) => {
              const point = eventCoords(event)
              if (!point) return
              window.foxbox.click({
                id: '*',
                ...point,
                button: mouseButton(event),
                double: event.detail === 2
              })
            }}
          />
        ) : (
          <div className="placeholder">Waiting for preview…</div>
        )}
      </div>
    </div>
  )
}
