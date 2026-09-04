import type { InstanceSnapshot } from '@shared/types'
import { StatusChip, statusDetail } from './status'

type Props = {
  instances: InstanceSnapshot[]
  focusedId: string | null
  onFocus: (id: string) => void
  onRestart: (id: string) => void
  onKill: (id: string) => void
  actionsLocked?: boolean
}

export default function Sidebar({ instances, focusedId, onFocus, onRestart, onKill, actionsLocked = false }: Props) {
  return (
    <aside className="sidebar">
      <div className="side-head">
        <span>Fleet</span>
        <span>{instances.length}</span>
      </div>
      {instances.map((scout) => (
        <div key={scout.id} className={`scout-row ${focusedId === scout.id ? 'active' : ''}`}>
          <button type="button" onClick={() => onFocus(scout.id)} style={{ all: 'unset', cursor: 'pointer' }}>
            <div className="scout-row-title">Scout {scout.id}</div>
            {statusDetail(scout) ? <div className="scout-row-meta">{statusDetail(scout)}</div> : null}
            <div style={{ marginTop: 8 }}>
              <StatusChip instance={scout} />
            </div>
          </button>
          <div className="scout-row-btns">
            <button
              className="icon-btn"
              type="button"
              title={`Restart Scout ${scout.id}`}
              aria-label={`Restart Scout ${scout.id}`}
              disabled={actionsLocked}
              onClick={() => onRestart(scout.id)}
            >
              ↻
            </button>
            <button
              className="icon-btn"
              type="button"
              onClick={() => onKill(scout.id)}
              aria-label={`Kill Scout ${scout.id}`}
              disabled={actionsLocked}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </aside>
  )
}
