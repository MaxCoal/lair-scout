import type { ThemeId } from '@shared/types'

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme === 'daylight' ? 'daylight' : 'dungeon'
}
