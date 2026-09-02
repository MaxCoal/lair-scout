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
  onRestart: (id: string) => void
}

export default function FocusView({ fox, driveAll, fleetCount, live, onBack, onRestart }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const lastMove = useRef(0)
  const poppedRef = useRef(fox.poppedOut)
  poppedRef.current = fox.poppedOut

  useEffect(() => {
    stageRef.current?.focus()
  }, [fox.id])

  useEffect(() => {
    if (!live) return undefined
    let cancelled = false
    let raf = 0
    let lastW = 0
    let lastH = 0
    let stable = 0
    const tick = (): void => {
      if (cancelled) return
      if (poppedRef.current) {
        void window.lairscout.dock(fox.id)
        return
      }
      const el = stageRef.current
      if (!el) {
        raf = window.requestAnimationFrame(tick)
        return
      }
      const rect = el.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      if (width < 80 || height < 60) {
        raf = window.requestAnimationFrame(tick)
        return
      }
      if (Math.abs(width - lastW) < 2 && Math.abs(height - lastH) < 2) stable += 1
      else stable = 0
      lastW = width
      lastH = height
      if (stable < 3) {
        raf = window.requestAnimationFrame(tick)
        return
      }
      void window.lairscout.interact(fox.id, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width,
        height
      })
    }
    raf = window.requestAnimationFrame(tick)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
      void window.lairscout.stopInteract(fox.id)
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
      void window.lairscout.key({
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
            {live ? `Live · Scout ${fox.id}` : driveAll ? `All scouts · showing Scout ${fox.id}` : `Scout ${fox.id}`}
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
            <button className="btn" type="button" onClick={() => window.lairscout.dock(fox.id)}>
              Dock
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => window.lairscout.popOut(fox.id)}>
              Pop out
            </button>
          )}
          <button className="btn danger" type="button" onClick={() => window.lairscout.reload(fox.id)}>
            Reload (may drop queue)
          </button>
          <button
            className="btn"
            type="button"
            title="New browser session (drops queue)"
            onClick={() => onRestart(fox.id)}
          >
            Restart
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
          if (live) {
            const dx = event.deltaX || (event.shiftKey ? event.deltaY : 0)
            if (!dx) return
            event.preventDefault()
            event.stopPropagation()
            void window.lairscout.scroll({ id: fox.id, dx, dy: 0 })
            return
          }
          event.preventDefault()
          void window.lairscout.scroll({ id, dx: event.deltaX, dy: event.deltaY })
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {live ? (
          <div className="placeholder">Live Chromium sits in this panel — click it directly.</div>
        ) : fox.screenshot ? (
          <img
            src={fox.screenshot}
            alt={driveAll ? 'Fleet live view' : `Scout ${fox.id} live view`}
            onMouseMove={(event) => {
              const now = Date.now()
              if (now - lastMove.current < 32) return
              lastMove.current = now
              const point = eventCoords(event)
              if (point) void window.lairscout.move({ id, ...point })
            }}
            onMouseDown={(event) => {
              const point = eventCoords(event)
              if (!point) return
              void window.lairscout.click({
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
