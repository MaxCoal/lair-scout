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

export function statusLine(instance: InstanceSnapshot): string {
  if (instance.error) return instance.error
  if (instance.statusLabel) return instance.statusLabel
  return LABELS[instance.status] || 'Waiting'
}
