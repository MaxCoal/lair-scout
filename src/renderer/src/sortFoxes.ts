import type { InstanceSnapshot } from '@shared/types'

export type FoxSort = 'id' | 'wait-asc' | 'wait-desc'

export function nextFoxSort(current: FoxSort): FoxSort {
  if (current === 'id') return 'wait-asc'
  if (current === 'wait-asc') return 'wait-desc'
  return 'id'
}

export function foxSortLabel(sort: FoxSort): string {
  if (sort === 'wait-asc') return 'Wait ↑'
  if (sort === 'wait-desc') return 'Wait ↓'
  return 'Sort'
}

function idRank(fox: InstanceSnapshot): number {
  const n = Number.parseInt(fox.id, 10)
  return Number.isFinite(n) ? n : 0
}

function statusBucket(fox: InstanceSnapshot): number {
  if (fox.status === 'admitted') return 0
  if (fox.status === 'waiting_for_queue') return 1
  if (fox.status === 'in_queue') return 2
  return 3
}

export function waitRank(fox: InstanceSnapshot): number {
  const text = String(fox.waitTime || '')
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

export function sortFoxes(instances: InstanceSnapshot[], sort: FoxSort): InstanceSnapshot[] {
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
