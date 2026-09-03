import type { InstanceSnapshot } from '@shared/types'
import { StatusChip, statusDetail } from './status'

type Props = {
  instances: InstanceSnapshot[]
  focusedId: string | null
  onFocus: (id: string) => void
  onRestart: (id: string) => void
  onKill: (id: string) => void
}

export default function Sidebar({ instances, focusedId, onFocus, onRestart, onKill }: Props) {
  return (
    <aside className="sidebar">
      <div className="side-head">
        <span>Fleet</span>
        <span>{instances.length}</span>
      </div>
      {instances.map((fox) => (
        <div key={fox.id} className={`fox-row ${focusedId === fox.id ? 'active' : ''}`}>
          <button type="button" onClick={() => onFocus(fox.id)} style={{ all: 'unset', cursor: 'pointer' }}>
            <div className="fox-row-title">Scout {fox.id}</div>
            {statusDetail(fox) ? <div className="fox-row-meta">{statusDetail(fox)}</div> : null}
            <div style={{ marginTop: 8 }}>
              <StatusChip instance={fox} />
            </div>
          </button>
          <div className="fox-row-btns">
            <button
              className="icon-btn"
              type="button"
              title={`Restart Scout ${fox.id}`}
              aria-label={`Restart Scout ${fox.id}`}
              onClick={() => onRestart(fox.id)}
            >
              ↻
            </button>
            <button className="icon-btn" type="button" onClick={() => onKill(fox.id)} aria-label={`Kill Scout ${fox.id}`}>
              ×
            </button>
          </div>
        </div>
      ))}
    </aside>
  )
}
