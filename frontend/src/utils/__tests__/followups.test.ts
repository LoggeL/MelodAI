import { describe, expect, it } from 'vitest'
import { removeFromSelection, restoreQueue, queueSnapshot, totalDuration, validDuration } from '../queue'
import { formatDay, formatTotalDuration } from '../format'
import { mosaicTiles } from '../../components/Library/mosaic'
import type { QueueItem } from '../../types'

const item = (id: string, extra: Partial<QueueItem> = {}): QueueItem => ({ id, ready: true, title: id, artist: '', thumbnail: '', status: '', progress: 0, error: false, vocalsUrl: '', musicUrl: '', lyricsUrl: '', ...extra })

describe('removeFromSelection', () => {
  it('keeps the selected song when another row is removed', () => {
    const result = removeFromSelection({ queue: [item('1'), item('2'), item('3')], currentIndex: 2 }, 0)
    expect(result?.removedCurrent).toBe(false)
    expect(result?.selection.queue.map(row => row.id)).toEqual(['2', '3'])
    expect(result?.selection.currentIndex).toBe(1)
  })
  it('moves on to the next playable song when the current one is removed', () => {
    const queue = [item('1', { error: true }), item('2', { ready: false }), item('3', { error: true }), item('4')]
    const result = removeFromSelection({ queue, currentIndex: 0 }, 0)
    expect(result?.removedCurrent).toBe(true)
    expect(result?.selection.queue.map(row => row.id)).toEqual(['2', '3', '4'])
    expect(result?.selection.currentIndex).toBe(2)
  })
  it('stops instead of wrapping around when nothing playable follows', () => {
    const result = removeFromSelection({ queue: [item('1'), item('2', { error: true })], currentIndex: 1 }, 1)
    expect(result?.removedCurrent).toBe(true)
    expect(result?.selection).toEqual({ queue: [item('1')], currentIndex: -1 })
  })
  it('ignores invalid indexes', () => {
    const selection = { queue: [item('1')], currentIndex: 0 }
    expect(removeFromSelection(selection, 5)).toBeNull()
    expect(removeFromSelection(selection, -1)).toBeNull()
    expect(removeFromSelection(selection, 0.5)).toBeNull()
  })
})

describe('song durations', () => {
  it('accepts only plausible lengths', () => {
    expect(validDuration(245)).toBe(true)
    for (const value of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 86401, '245', null, undefined]) expect(validDuration(value)).toBe(false)
  })
  it('sums the known lengths of the setlist', () => {
    expect(totalDuration([item('1', { duration: 200 }), item('2'), item('3', { duration: 56.5 })])).toBe(256.5)
    expect(totalDuration([])).toBe(0)
  })
  it('keeps valid durations through persistence and drops invalid ones', () => {
    const snapshot = queueSnapshot([item('1', { duration: 180 }), item('2', { duration: -1 })], 0)
    expect(snapshot.items[0].duration).toBe(180)
    expect(snapshot.items[1].duration).toBeUndefined()
    const state = restoreQueue([{ id: '1', duration: 180 }, { id: '2', duration: 'lang' }], 0)
    expect(state.queue[0].duration).toBe(180)
    expect(state.queue[1].duration).toBeUndefined()
  })
  it('formats the setlist total', () => {
    expect(formatTotalDuration(1456)).toBe('24:16')
    expect(formatTotalDuration(5056)).toBe('1:24:16')
    expect(formatTotalDuration(0)).toBe('0:00')
  })
  it('formats UTC day keys', () => {
    expect(formatDay('2026-10-08')).toBe('Do., 08.10.')
    expect(formatDay('kaputt')).toBe('–')
    expect(formatDay(null)).toBe('–')
  })
})

describe('playlist mosaic', () => {
  it('shows a single cover full size', () => {
    expect(mosaicTiles(['a'])).toEqual(['a'])
    expect(mosaicTiles([])).toEqual([])
    expect(mosaicTiles(undefined)).toEqual([])
  })
  it('fills a 2×2 grid and leaves missing tiles tinted', () => {
    expect(mosaicTiles(['a', 'b'])).toEqual(['a', 'b', null, null])
    expect(mosaicTiles(['a', '', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd'])
  })
})
