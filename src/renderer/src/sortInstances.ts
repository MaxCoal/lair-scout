import type { InstanceSnapshot } from '@shared/types'

export type InstanceSort = 'id' | 'wait-asc' | 'wait-desc'

export function nextInstanceSort(current: InstanceSort): InstanceSort {
  if (current === 'id') return 'wait-asc'
  if (current === 'wait-asc') return 'wait-desc'
  return 'id'
}

export function instanceSortLabel(sort: InstanceSort): string {
  if (sort === 'wait-asc') return 'Wait ↑'
  if (sort === 'wait-desc') return 'Wait ↓'
  return 'Sort'
}

function idRank(instance: InstanceSnapshot): number {
  const n = Number.parseInt(instance.id, 10)
  return Number.isFinite(n) ? n : 0
}

function statusBucket(instance: InstanceSnapshot): number {
  if (instance.status === 'admitted') return 0
  if (instance.status === 'waiting_for_queue') return 1
  if (instance.status === 'in_queue') return 2
  return 3
}

export function waitRank(instance: InstanceSnapshot): number {
  const text = String(instance.waitTime || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (!text) return 10_000
  if (/more than an hour|over an hour|over 1 hour|>\s*an hour/.test(text)) return 90
  if (/less than a minute|under a minute|<\s*1\s*min/.test(text) || text === '<1 min') return 0.5
  const hours = text.match(/(\d+)\s*hours?/)
  if (hours) return Number(hours[1]) * 60
  const mins = text.match(/(\d+)/)
  if (mins) return Number(mins[1])
  return 10_000
}

export function sortInstances(instances: InstanceSnapshot[], sort: InstanceSort): InstanceSnapshot[] {
  if (sort === 'id') return instances
  const dir = sort === 'wait-asc' ? 1 : -1
  return [...instances].sort((a, b) => {
    const bucket = statusBucket(a) - statusBucket(b)
    if (bucket !== 0) return bucket
    if (a.status === 'in_queue') {
      const wait = (waitRank(a) - waitRank(b)) * dir
      if (wait !== 0) return wait
    }
    return idRank(a) - idRank(b)
  })
}
