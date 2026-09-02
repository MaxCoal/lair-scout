import type { InstanceSnapshot, SessionStatus } from '@shared/types'

const LABELS: Record<SessionStatus, string> = {
  idle: 'Idle',
  loading: 'Loading',
  in_queue: 'In queue',
  admitted: 'Admitted',
  error: 'Error'
}

export function StatusChip({ status }: { status: SessionStatus }) {
  return <span className={`chip ${status}`}>{LABELS[status]}</span>
}

export function statusLine(fox: InstanceSnapshot): string {
  if (fox.error) return fox.error
  if (fox.queueNumber) return `Queue ${fox.queueNumber}`
  if (fox.waitTime) return fox.waitTime
  if (fox.host) return fox.host
  return 'Waiting'
}
