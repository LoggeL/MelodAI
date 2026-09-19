import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPlayerSettings, loadStoredQueue, queueStorageKey } from '../playerStorage'

afterEach(() => vi.unstubAllGlobals())

describe('player persistence', () => {
  it('never restores an unowned legacy queue into another account', () => {
    const values: Record<string, string> = { melodai_queue: JSON.stringify({ items: [{ id: '111' }], currentIndex: 0 }), 'melodai_queue:alice': JSON.stringify({ items: [{ id: '222' }], currentIndex: 0 }) }
    vi.stubGlobal('localStorage', { getItem: (key: string) => values[key] ?? null })
    expect(loadStoredQueue('alice').queue[0].id).toBe('222')
    expect(loadStoredQueue('bob').queue).toEqual([])
    expect(loadStoredQueue().queue).toEqual([])
    expect(queueStorageKey('alice')).not.toBe(queueStorageKey('bob'))
  })
  it('supports blocked browser storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(loadStoredQueue('alice').queue).toEqual([])
    expect(loadPlayerSettings()).toEqual({ vocalsVolume: 50, instrumentalVolume: 50, karaokeMode: false })
  })
  it('validates settings before assigning audio gain values', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ vocalsVolume: 500, instrumentalVolume: 'loud', karaokeMode: 'false' }) })
    expect(loadPlayerSettings()).toEqual({ vocalsVolume: 100, instrumentalVolume: 50, karaokeMode: false })
  })
})
