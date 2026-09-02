import type { InstanceSnapshot, SessionStatus } from '@shared/types'

const LABELS: Record<SessionStatus, string> = {
  idle: 'Idle',
  loading: 'Loading',
  not_in_queue: 'Not In Queue',
  waiting_for_queue: 'Waiting for Queue',
  in_queue: 'In Queue',
  admitted: 'Admitted',
  error: 'Error'
}

export function StatusChip({ status }: { status: SessionStatus }) {
  return <span className={`chip ${status}`}>{LABELS[status]}</span>
}

export function statusLine(fox: InstanceSnapshot): string {
  if (fox.error) return fox.error
  if (fox.statusLabel) return fox.statusLabel
  return LABELS[fox.status] || 'Waiting'
}
