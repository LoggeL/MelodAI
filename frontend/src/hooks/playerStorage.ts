import { restoreQueue, type QueueSelection } from '../utils/queue'

export interface PlayerSettings { vocalsVolume: number; instrumentalVolume: number; karaokeMode: boolean }
export const PLAYER_STORAGE_KEY = 'melodai_player'

export function queueStorageKey(accountKey?: string): string | null {
  // The old global key has no owner and cannot safely be assigned to an account.
  return accountKey ? `melodai_queue:${encodeURIComponent(accountKey)}` : null
}

export function loadStoredQueue(accountKey?: string): QueueSelection {
  try {
    const key = queueStorageKey(accountKey)
    const data = key ? JSON.parse(localStorage.getItem(key) || 'null') : null
    return restoreQueue(data?.items, data?.currentIndex)
  } catch { return { queue: [], currentIndex: -1 } }
}

export function normalizeVolume(value: unknown, fallback = 50): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
}

export function loadPlayerSettings(): PlayerSettings {
  try {
    const data = JSON.parse(localStorage.getItem(PLAYER_STORAGE_KEY) || 'null')
    return { vocalsVolume: normalizeVolume(data?.vocalsVolume), instrumentalVolume: normalizeVolume(data?.instrumentalVolume), karaokeMode: data?.karaokeMode === true }
  } catch { return { vocalsVolume: 50, instrumentalVolume: 50, karaokeMode: false } }
}
