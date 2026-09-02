import { useEffect, useRef } from 'react'
import type { InstanceSnapshot } from '@shared/types'
import { StatusChip, statusLine } from './status'
import { eventCoords, mouseButton, targetId } from '../input'

type Props = {
  fox: InstanceSnapshot
  driveAll: boolean
  fleetCount: number
  live: boolean
  onBack: () => void
}

export default function FocusView({ fox, driveAll, fleetCount, live, onBack }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const lastMove = useRef(0)

  useEffect(() => {
    stageRef.current?.focus()
  }, [fox.id])

  useEffect(() => {
    if (!live) return undefined
    const report = (): void => {
      const el = stageRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      void window.foxbox.interact(fox.id, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      })
    }
    report()
    requestAnimationFrame(() => requestAnimationFrame(report))
    const observer = new ResizeObserver(report)
    if (stageRef.current) observer.observe(stageRef.current)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
      void window.foxbox.stopInteract(fox.id)
    }
  }, [fox.id, live])

  useEffect(() => {
    if (live || driveAll) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onBack()
        return
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.type === 'keydown' && event.repeat) return
      event.preventDefault()
      void window.foxbox.key({
        id: fox.id,
        key: event.key,
        type: event.type === 'keyup' ? 'up' : 'down'
      })
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [driveAll, fox.id, live, onBack])

  const id = targetId(driveAll && !live, fox.id)

  return (
    <div className="focus">
      <div className="focus-bar">
        <div>
          <strong>
            {live ? `Live · Fox ${fox.id}` : driveAll ? `All foxes · showing Fox ${fox.id}` : `Fox ${fox.id}`}
          </strong>
          <div className="mono">
            {live
              ? 'Click and type directly in this window'
              : driveAll
                ? `Mirroring to ${fleetCount}`
                : statusLine(fox)}
          </div>
        </div>
        <div className="top-actions">
          <StatusChip status={fox.status} />
          {fox.poppedOut ? (
            <button className="btn" type="button" onClick={() => window.foxbox.dock(fox.id)}>
              Dock
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => window.foxbox.popOut(fox.id)}>
              Pop out
            </button>
          )}
          <button className="btn danger" type="button" onClick={() => window.foxbox.reload(fox.id)}>
            Reload (may drop queue)
          </button>
          <button className="btn" type="button" onClick={onBack}>
            Back to grid
          </button>
        </div>
      </div>
      <div
        className={`focus-stage ${driveAll && !live ? 'herd' : ''} ${live ? 'live' : ''}`}
        tabIndex={0}
        ref={stageRef}
        onWheel={(event) => {
          if (live) return
          event.preventDefault()
          void window.foxbox.scroll({ id, dx: event.deltaX, dy: event.deltaY })
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {live ? (
          <div className="placeholder">Live Chromium sits in this panel — click it directly.</div>
        ) : fox.screenshot ? (
          <img
            src={fox.screenshot}
            alt={driveAll ? 'Herd live view' : `Fox ${fox.id} live view`}
            onMouseMove={(event) => {
              const now = Date.now()
              if (now - lastMove.current < 32) return
              lastMove.current = now
              const point = eventCoords(event)
              if (point) void window.foxbox.move({ id, ...point })
            }}
            onMouseDown={(event) => {
              const point = eventCoords(event)
              if (!point) return
              void window.foxbox.click({
                id,
                ...point,
                button: mouseButton(event),
                double: event.detail === 2
              })
            }}
          />
        ) : (
          <div className="placeholder">No preview yet</div>
        )}
      </div>
    </div>
  )
}
