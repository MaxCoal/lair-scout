import { useEffect, useRef } from 'react'
import type { InstanceSnapshot } from '@shared/types'
import { StatusChip, statusLine } from './status'

type Props = {
  fox: InstanceSnapshot
  onBack: () => void
}

function coords(event: React.MouseEvent<HTMLImageElement>): { nx: number; ny: number } | null {
  const img = event.currentTarget
  const rect = img.getBoundingClientRect()
  const { naturalWidth: nw, naturalHeight: nh } = img
  if (!nw || !nh) return null
  const scale = Math.min(rect.width / nw, rect.height / nh)
  const dw = nw * scale
  const dh = nh * scale
  const ox = rect.left + (rect.width - dw) / 2
  const oy = rect.top + (rect.height - dh) / 2
  const nx = (event.clientX - ox) / dw
  const ny = (event.clientY - oy) / dh
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null
  return { nx, ny }
}

export default function FocusView({ fox, onBack }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    stageRef.current?.focus()
  }, [fox.id])

  useEffect(() => {
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
  }, [fox.id, onBack])

  return (
    <div className="focus">
      <div className="focus-bar">
        <div>
          <strong>Fox {fox.id}</strong>
          <div className="mono">{statusLine(fox)}</div>
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
        className="focus-stage"
        tabIndex={0}
        ref={stageRef}
        onWheel={(event) => {
          event.preventDefault()
          void window.foxbox.scroll({ id: fox.id, dx: event.deltaX, dy: event.deltaY })
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {fox.screenshot ? (
          <img
            src={fox.screenshot}
            alt={`Fox ${fox.id} live view`}
            onMouseMove={(event) => {
              const point = coords(event)
              if (point) void window.foxbox.move({ id: fox.id, ...point })
            }}
            onMouseDown={(event) => {
              const point = coords(event)
              if (!point) return
              const button = event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left'
              void window.foxbox.click({
                id: fox.id,
                ...point,
                button,
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
