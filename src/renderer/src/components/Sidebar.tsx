import type { InstanceSnapshot } from '@shared/types'
import { StatusChip, statusLine } from './status'

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
            <div className="fox-row-title">Fox {fox.id}</div>
            <div className="fox-row-meta">{statusLine(fox)}</div>
            <div style={{ marginTop: 8 }}>
              <StatusChip status={fox.status} />
            </div>
          </button>
          <div className="fox-row-btns">
            <button
              className="icon-btn"
              type="button"
              title={`Restart Fox ${fox.id}`}
              aria-label={`Restart Fox ${fox.id}`}
              onClick={() => onRestart(fox.id)}
            >
              ↻
            </button>
            <button className="icon-btn" type="button" onClick={() => onKill(fox.id)} aria-label={`Kill Fox ${fox.id}`}>
              ×
            </button>
          </div>
        </div>
      ))}
    </aside>
  )
}
