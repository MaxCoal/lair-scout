import type { ClickPayload } from '@shared/types'

export function eventCoords(event: React.MouseEvent<HTMLImageElement>): { nx: number; ny: number } | null {
  const img = event.currentTarget
  const rect = img.getBoundingClientRect()
  const { naturalWidth: nw, naturalHeight: nh } = img
  if (!nw || !nh) return null
  const scale = Math.min(rect.width / nw, rect.height / nh)
  const dw = nw * scale
  const dh = nh * scale
  const ox = rect.left + (rect.width - dw) / 2
  const oy = rect.top + (rect.height - dh) / 2
  const nx = (event.clientX - ox) / dw
  const ny = (event.clientY - oy) / dh
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null
  return { nx, ny }
}

export function targetId(driveAll: boolean, id: string): string {
  return driveAll ? '*' : id
}

export function mouseButton(event: React.MouseEvent): ClickPayload['button'] {
  if (event.button === 2) return 'right'
  if (event.button === 1) return 'middle'
  return 'left'
}
