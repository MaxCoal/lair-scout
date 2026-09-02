import type { InstanceSnapshot } from '@shared/types'
import { StatusChip, statusLine } from './status'

type Props = {
  fox: InstanceSnapshot
  url: string
  onFocus: (id: string) => void
  onGotoOne: (id: string) => void
}

export default function InstanceTile({ fox, onFocus, onGotoOne }: Props) {
  return (
    <article
      className={`tile ${fox.status} ${fox.admittedFlash ? 'flash' : ''}`}
      onClick={() => onFocus(fox.id)}
    >
      {fox.screenshot ? <img src={fox.screenshot} alt={`Fox ${fox.id}`} /> : <div className="placeholder">Starting Firefox…</div>}
      <div className="tile-overlay">
        <div>
          <div style={{ fontWeight: 600 }}>Fox {fox.id}</div>
          <div className="mono">{statusLine(fox)}</div>
        </div>
        <div className="tile-actions">
          <StatusChip status={fox.status} />
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
        </div>
      </div>
    </article>
  )
}
