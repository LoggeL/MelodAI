import { describe, expect, it } from 'vitest'
import { queueSnapshot } from '../queue'
import type { QueueItem } from '../../types'
const item = (id: string, ready = true): QueueItem => ({ id, ready, title: id, artist: '', thumbnail: '', status: '', progress: 0, error: false, vocalsUrl: '', musicUrl: '', lyricsUrl: '' })
describe('queue persistence and sync', () => {
  it('keeps the selected song when a pending song precedes it', () => {
    expect(queueSnapshot([item('1', false), item('2'), item('3')], 1)).toEqual({ items: [expect.objectContaining({ id: '2' }), expect.objectContaining({ id: '3' })], currentIndex: 0 })
  })
  it('does not select another song when the current one is not ready', () => {
    expect(queueSnapshot([item('1', false), item('2')], 0).currentIndex).toBe(-1)
  })
  it('supports clearing the last song', () => {
    expect(queueSnapshot([], -1)).toEqual({ items: [], currentIndex: -1 })
  })
})

import { adjacentReadyIndex, restoreQueue, selectById } from '../queue'

describe('queue restoration and selection', () => {
  it('retains the selected ID after invalid earlier rows are removed', () => {
    const state = restoreQueue([{ id: '../bad' }, { id: ' 123 ', title: 'Song' }, null], 1)
    expect(state.currentIndex).toBe(0)
    expect(state.queue[0].id).toBe('123')
    expect(state.queue[0].vocalsUrl).toBe('/songs/123/vocals.mp3')
  })
  it('deduplicates IDs without changing the chosen song', () => {
    const state = restoreQueue([{ id: '1' }, { id: '2' }, { id: '1' }], 2)
    expect(state.queue.map(item => item.id)).toEqual(['1', '2'])
    expect(state.currentIndex).toBe(0)
  })
  it('does not substitute another song for a deleted selection', () => {
    expect(selectById([item('3')], '2').currentIndex).toBe(-1)
    expect(restoreQueue([{ id: '1' }], 10).currentIndex).toBe(-1)
    expect(restoreQueue({}, 0)).toEqual({ queue: [], currentIndex: -1 })
  })
  it('skips pending and failed rows while cycling', () => {
    const queue = [item('1'), item('2', false), { ...item('3'), error: true }, item('4')]
    expect(adjacentReadyIndex(queue, 0, 1)).toBe(3)
    expect(adjacentReadyIndex(queue, 0, -1)).toBe(3)
    expect(adjacentReadyIndex(queue, -1, -1)).toBe(3)
    expect(adjacentReadyIndex(queue, -1, 1)).toBe(0)
    expect(adjacentReadyIndex([item('1', false)], -1, 1)).toBe(-1)
    expect(adjacentReadyIndex([], -1, 1)).toBe(-1)
  })
})
