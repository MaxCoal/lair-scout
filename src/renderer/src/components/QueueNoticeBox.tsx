import type { QueueNotice } from '@shared/types'

type Props = {
  notice: QueueNotice
  onDismiss: () => void
}

export default function QueueNoticeBox({ notice, onDismiss }: Props) {
  const stock = notice.kind === 'stock'
  const title = stock
    ? ['Out of stock', notice.time].filter(Boolean).join(' · ')
    : [notice.header.replace(/:\s*$/, ''), notice.time].filter(Boolean).join(': ')
  return (
    <aside className={`queue-notice ${stock ? 'stock' : ''}`} role="status">
      <div className="queue-notice-head">
        <strong>{title || (stock ? 'Out of stock' : 'Queue message')}</strong>
        <button className="icon-btn" type="button" onClick={onDismiss} aria-label="Dismiss queue message">
          ×
        </button>
      </div>
      <p>{notice.text}</p>
    </aside>
  )
}
