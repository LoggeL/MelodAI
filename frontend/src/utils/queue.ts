import type { QueueItem } from '../types'
import { isValidTrackId, normalizeTrackId, trackPathSegment } from './trackId'

export interface QueueMetadata { id: string; title: string; artist: string; thumbnail: string; duration?: number }
export interface QueueSelection { queue: QueueItem[]; currentIndex: number }

/** Persist only playable songs while retaining the selected song by identity. */
export function queueSnapshot(queue: QueueItem[], currentIndex: number) {
  const currentId = queue[currentIndex]?.id
  const items = queue.filter(item => item.ready && !item.error).map(({ id, title, artist, thumbnail, duration }) => ({ id, title, artist, thumbnail, ...(validDuration(duration) ? { duration } : {}) }))
  return { items, currentIndex: currentId ? items.findIndex(item => item.id === currentId) : -1 }
}

/** Song length in seconds as stored in queues; untrusted input elsewhere. */
export function validDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 86400
}

/** Sum of the known lengths, for „7 Songs · 24:16“. */
export function totalDuration(queue: QueueItem[]): number {
  return queue.reduce((sum, item) => sum + (validDuration(item.duration) ? item.duration : 0), 0)
}

export function queueItem(metadata: QueueMetadata, ready = true): QueueItem {
  const id = normalizeTrackId(metadata.id)
  const path = trackPathSegment(id)
  return { ...metadata, id, vocalsUrl: `/songs/${path}/vocals.mp3`, musicUrl: `/songs/${path}/no_vocals.mp3`, lyricsUrl: `/api/track/${path}/lyrics`, ready, progress: ready ? 100 : 0, status: ready ? 'ready' : 'processing', error: false }
}

/** Browser storage and remote events are untrusted; filter malformed rows by ID. */
export function restoreQueue(items: unknown, selectedIndex: unknown): QueueSelection {
  if (!Array.isArray(items)) return { queue: [], currentIndex: -1 }
  const selected = typeof selectedIndex === 'number' && Number.isInteger(selectedIndex) ? items[selectedIndex]?.id : null
  const selectedId = isValidTrackId(selected) ? normalizeTrackId(selected) : null
  const seen = new Set<string>()
  const queue = items.flatMap(item => {
    if (!item || !isValidTrackId(item.id)) return []
    const id = normalizeTrackId(item.id)
    if (seen.has(id)) return []
    seen.add(id)
    return [queueItem({ id, title: typeof item.title === 'string' ? item.title : 'Unbekannter Song', artist: typeof item.artist === 'string' ? item.artist : '', thumbnail: typeof item.thumbnail === 'string' ? item.thumbnail : '', ...(validDuration(item.duration) ? { duration: item.duration } : {}) })]
  })
  return { queue, currentIndex: selectedId ? queue.findIndex(item => item.id === selectedId) : -1 }
}

export function selectById(queue: QueueItem[], id: string | undefined): QueueSelection {
  return { queue, currentIndex: id ? queue.findIndex(item => item.id === id) : -1 }
}

export function adjacentReadyIndex(queue: QueueItem[], currentIndex: number, direction: 1 | -1): number {
  const origin = currentIndex < 0 ? (direction === 1 ? -1 : 0) : currentIndex
  for (let step = 1; step <= queue.length; step++) {
    const index = ((origin + direction * step) % queue.length + queue.length) % queue.length
    if (queue[index].ready && !queue[index].error) return index
  }
  return -1
}

/**
 * Remove the row at `index`. Another selected song stays selected by identity. Removing the selected song
 * selects the next playable song after it, or nothing when none follows (playback then stops).
 */
export function removeFromSelection(selection: QueueSelection, index: number): { selection: QueueSelection; removedCurrent: boolean } | null {
  const { queue, currentIndex } = selection
  if (!Number.isInteger(index) || !queue[index]) return null
  const rest = queue.filter((_, i) => i !== index)
  if (index !== currentIndex) return { selection: selectById(rest, queue[currentIndex]?.id), removedCurrent: false }
  const next = rest.findIndex((item, i) => i >= index && item.ready && !item.error)
  return { selection: { queue: rest, currentIndex: next }, removedCurrent: true }
}
