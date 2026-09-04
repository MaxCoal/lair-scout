import { useEffect, useRef } from 'react'
import type { InstanceSnapshot } from '@shared/types'
import { StatusChip, statusDetail } from './status'
import { useAdmittedTimer } from '../useAdmittedTimer'
import { eventCoords, mouseButton, targetId } from '../input'

type Props = {
  instance: InstanceSnapshot
  driveAll: boolean
  fleetCount: number
  live: boolean
  onBack: () => void
  onRestart: (id: string) => void
}

export default function FocusView({ instance, driveAll, fleetCount, live, onBack, onRestart }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const lastMove = useRef(0)
  const countdown = useAdmittedTimer(instance)

  useEffect(() => {
    stageRef.current?.focus()
  }, [instance.id])

  useEffect(() => {
    if (!live) return undefined
    const last = { x: 0, y: 0, width: 0, height: 0 }
    let timer = 0
    const report = (): void => {
      const el = stageRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const next = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
      if (
        Math.abs(next.x - last.x) < 2 &&
        Math.abs(next.y - last.y) < 2 &&
        Math.abs(next.width - last.width) < 4 &&
        Math.abs(next.height - last.height) < 4
      ) {
        return
      }
      last.x = next.x
      last.y = next.y
      last.width = next.width
      last.height = next.height
      void window.lairscout.interact(instance.id, next)
    }
    const schedule = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(report, 50)
    }
    report()
    const observer = new ResizeObserver(schedule)
    if (stageRef.current) observer.observe(stageRef.current)
    window.addEventListener('resize', schedule)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      void window.lairscout.stopInteract(instance.id)
    }
  }, [instance.id, live])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onBack()
        return
      }
      if (live || driveAll) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.type === 'keydown' && event.repeat) return
      event.preventDefault()
      void window.lairscout.key({
        id: instance.id,
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
  }, [driveAll, instance.id, live, onBack])

  const id = targetId(driveAll && !live, instance.id)

  return (
    <div className="focus">
      <div className="focus-bar">
        <div>
          <strong>
            {live ? `Live · Scout ${instance.id}` : driveAll ? `All scouts · showing Scout ${instance.id}` : `Scout ${instance.id}`}
          </strong>
          <div className="mono">
            {live
              ? 'Click and type directly in this window'
              : driveAll
                ? `Mirroring to ${fleetCount}`
                : countdown || statusDetail(instance) || instance.host}
          </div>
        </div>
        <div className="top-actions">
          <StatusChip instance={instance} />
          {instance.poppedOut ? (
            <button className="btn" type="button" onClick={() => window.lairscout.dock(instance.id)}>
              Dock
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => window.lairscout.popOut(instance.id)}>
              Pop out
            </button>
          )}
          <button className="btn danger" type="button" onClick={() => window.lairscout.reload(instance.id)}>
            Reload (may drop queue)
          </button>
          <button
            className="btn"
            type="button"
            title="New browser session (drops queue)"
            onClick={() => onRestart(instance.id)}
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
            event.preventDefault()
            event.stopPropagation()
            return
          }
          event.preventDefault()
          void window.lairscout.scroll({ id, dx: event.deltaX, dy: event.deltaY })
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {live ? (
          <div className="placeholder">Live Chromium sits in this panel — click it directly.</div>
        ) : instance.screenshot ? (
          <img
            src={instance.screenshot}
            alt={driveAll ? 'Fleet live view' : `Scout ${instance.id} live view`}
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
