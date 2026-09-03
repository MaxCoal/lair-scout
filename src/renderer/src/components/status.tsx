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

// Worker labels that only restate the chip, so the detail line stays empty for them.
const STATE_ONLY =
  /^(idle|loading|starting…|not in queue|in queue(,.*)?|admitted(, waiting for queue)?|waiting for queue|waiting in queue…|error)$/i

function compactWait(wait: string): string {
  if (/more th[ae]n an hour/i.test(wait)) return '1 hr+'
  return wait
}

export function statusText(instance: InstanceSnapshot): string {
  const state = LABELS[instance.status] || 'Waiting'
  if (instance.status === 'in_queue' && instance.waitTime) {
    return `${state} · ${compactWait(instance.waitTime)}`
  }
  return state
}

export function statusDetail(instance: InstanceSnapshot): string {
  if (instance.error) return instance.error
  const label = instance.statusLabel?.trim() || ''
  return STATE_ONLY.test(label) ? '' : label
}

export function StatusChip({ instance }: { instance: InstanceSnapshot }) {
  return <span className={`chip ${instance.status}`}>{statusText(instance)}</span>
}
