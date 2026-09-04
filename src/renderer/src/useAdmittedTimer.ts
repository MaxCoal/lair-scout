import { useEffect, useState } from 'react'
import type { InstanceSnapshot } from '@shared/types'

const CHECKOUT_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

export function useAdmittedTimer(instance: InstanceSnapshot): string {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!instance.admittedAt || (instance.status !== 'admitted' && instance.status !== 'purchasing')) return undefined
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [instance.admittedAt, instance.status])

  if (!instance.admittedAt || (instance.status !== 'admitted' && instance.status !== 'purchasing')) return ''

  const elapsed = Date.now() - instance.admittedAt
  const remaining = CHECKOUT_WINDOW_MS - elapsed

  if (remaining <= 0) return 'Time up!'

  const totalSecs = Math.ceil(remaining / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  return `${mins}:${String(secs).padStart(2, '0')} left`
}
