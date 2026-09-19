// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayer } from '../usePlayer'
import { useSync, type SyncState } from '../useSync'
import { queueSnapshot } from '../../utils/queue'
import { tracks } from '../../services/api'
import type { TrackMetadata } from '../../types'

vi.mock('../../services/api', async original => {
  const actual = await original<typeof import('../../services/api')>()
  return { ...actual, tracks: { ...actual.tracks, info: vi.fn(), add: vi.fn(), lyrics: vi.fn(), favorites: vi.fn(), logPlay: vi.fn() } }
})
vi.mock('../useToast', () => ({ showToast: vi.fn() }))

class FakeContext {
  state: AudioContextState = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn(async () => {})
  close = vi.fn(async () => {})
  decodeAudioData = vi.fn(async () => ({ duration: 60 } as AudioBuffer))
  createGain() { return { gain: { value: 1 }, connect: vi.fn() } }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0 } }
  createBufferSource() { return { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null } }
}
class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, (event: { data: string }) => void>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor() { FakeEventSource.instances.push(this) }
  addEventListener(name: string, handler: (event: { data: string }) => void) { this.listeners.set(name, handler) }
  emit(name: string, data: unknown) { this.listeners.get(name)?.({ data: JSON.stringify(data) }) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const metadata = (id: string): TrackMetadata => ({ id, title: `Song ${id}`, artist: 'Artist', album: 'Album', duration: 60, img_url: null })
const queue = (id: string) => [{ id, title: `Song ${id}`, artist: 'Artist', thumbnail: '' }]
const snapshot = (id: string, version: number, initial = false): SyncState => ({ queue: queue(id), currentIndex: 0, isPlaying: false, version, ...(initial ? { initial: true } : {}) })
const lyrics = (id: string) => ({ segments: [{ start: 0, end: 10, speaker: 'A', words: [{ word: `Lyrics ${id}`, start: 0, end: 10, speaker: 'A' }] }] })
let root: Root
let player: ReturnType<typeof usePlayer>
let restored: ReturnType<typeof deferred<Awaited<ReturnType<typeof tracks.info>>>>

function Harness({ target }: { target?: string }) {
  const current = usePlayer({ accountKey: 'member', isAdmin: true })
  const sync = useSync({ enabled: true, onSyncState: current.applySyncState, onCommand: current.applySyncCommand })
  useEffect(() => { player = current }, [current])
  useEffect(() => {
    current.syncPlaybackIntentRef.current = sync.markPlaybackIntent
    current.syncCommandRef.current = sync.sendCommand
    current.syncPushRef.current = () => {
      const state = queueSnapshot(current.queue, current.currentIndex)
      sync.pushQueue(state.items, state.currentIndex, current.isPlaying)
    }
  }, [current, sync])
  useEffect(() => { if (target) void player.addToQueue(target, undefined, true) }, [target])
  return createElement('output', { 'data-track': current.currentTrack?.id }, current.lyrics?.segments[0]?.words[0]?.word)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8))))
  FakeEventSource.instances = []
  localStorage.clear()
  localStorage.setItem('melodai_queue:member', JSON.stringify({ items: queue('1'), currentIndex: 0 }))
  restored = deferred()
  vi.mocked(tracks.info).mockImplementation(id => id === '1' ? restored.promise : Promise.resolve({ metadata: metadata(id), complete: true, status: null }))
  vi.mocked(tracks.add).mockImplementation(async id => ({ status: 'ready', progress: 100, metadata: metadata(id) }))
  vi.mocked(tracks.lyrics).mockImplementation(async id => lyrics(id))
  vi.mocked(tracks.favorites).mockResolvedValue([])
  vi.mocked(tracks.logPlay).mockResolvedValue(new Response('{}'))
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const mount = async (target?: string) => { await act(async () => root.render(createElement(Harness, { target }))) }
const emit = async (name: string, data: unknown, source = FakeEventSource.instances.at(-1)!) => { await act(async () => source.emit(name, data)) }
const finishRestore = async () => { await act(async () => restored.resolve({ metadata: metadata('1'), complete: true, status: null })) }

// Exercise the real player, sync hook and audio controller together. Only
// network responses, the SSE transport and Web Audio are faked.
describe('first synchronization and explicit playback', () => {
  it('keeps a route Play request made before /add, restore and initial SSE have completed', async () => {
    const adding = deferred<Awaited<ReturnType<typeof tracks.add>>>()
    vi.mocked(tracks.add).mockReturnValue(adding.promise)
    await mount('2')
    expect(player.queue.map(item => item.id)).toEqual(['1', '2'])
    await emit('sync_state', snapshot('1', 10, true))
    await emit('sync_ready', {})
    await finishRestore()
    await act(async () => adding.resolve({ status: 'ready', progress: 100, metadata: metadata('2') }))
    expect(player.currentTrack?.id).toBe('2')
    expect(player.queue.map(item => item.id)).toEqual(['1', '2'])
    expect(player.isPlaying).toBe(true)
    expect(player.duration).toBe(60)
    expect(player.lyrics).toEqual(lyrics('2'))
  })

  it('hydrates lyrics for the same paused selection even when SSE replaces stored row identities', async () => {
    await mount()
    await emit('sync_state', snapshot('1', 10, true))
    await finishRestore()
    expect(player.currentTrack?.id).toBe('1')
    expect(player.lyrics).toEqual(lyrics('1'))
    expect(player.isPlaying).toBe(false)
    expect(tracks.lyrics).toHaveBeenCalledTimes(1)
  })

  it('accepts the first server snapshot when there was no explicit Play request', async () => {
    await mount()
    await emit('sync_state', snapshot('3', 10, true))
    await finishRestore()
    expect(player.currentTrack?.id).toBe('3')
    expect(player.lyrics).toEqual(lyrics('3'))
  })

  it('lets a later live update cancel a pending local Play and prevents its late response reviving it', async () => {
    const adding = deferred<Awaited<ReturnType<typeof tracks.add>>>()
    vi.mocked(tracks.add).mockReturnValue(adding.promise)
    await mount('2')
    await emit('sync_state', snapshot('1', 10, true))
    await emit('sync_state', snapshot('3', 11))
    await finishRestore()
    await act(async () => adding.resolve({ status: 'ready', progress: 100, metadata: metadata('2') }))
    expect(player.currentTrack?.id).toBe('3')
    expect(player.queue.map(item => item.id)).toEqual(['3'])
    expect(player.isPlaying).toBe(false)
    expect(player.lyrics).toEqual(lyrics('3'))
  })

  it('keeps live pause commands authoritative after skipping a stale snapshot', async () => {
    await mount('2')
    await emit('sync_state', snapshot('1', 10, true))
    expect(player.isPlaying).toBe(true)
    await emit('command', { command: 'pause', payload: {} })
    expect(player.currentTrack?.id).toBe('2')
    expect(player.isPlaying).toBe(false)
  })

  it('accepts older-server unmarked snapshots even while a local Play request is pending', async () => {
    await mount('2')
    await emit('sync_state', snapshot('1', 10))
    expect(player.currentTrack?.id).toBe('1')
    expect(player.isPlaying).toBe(false)
  })

  it('accepts reconnect snapshots after a local Play, even if the first connection never became ready', async () => {
    await mount('2')
    await emit('sync_state', snapshot('1', 10, true))
    const first = FakeEventSource.instances[0]
    await act(async () => { first.onerror?.(); await vi.advanceTimersByTimeAsync(1000) })
    expect(first.close).toHaveBeenCalledOnce()
    expect(FakeEventSource.instances).toHaveLength(2)
    await emit('sync_state', snapshot('3', 11, true))
    expect(player.currentTrack?.id).toBe('3')
    expect(player.isPlaying).toBe(false)
    await emit('sync_state', snapshot('1', 12), first)
    expect(player.currentTrack?.id).toBe('3')
  })

  it('ends the first-hydration exception when sync_ready arrives without a saved snapshot', async () => {
    await mount()
    await emit('sync_ready', {})
    await act(async () => player.addToQueue('2', undefined, true))
    await emit('sync_state', snapshot('3', 10, true))
    expect(player.currentTrack?.id).toBe('3')
  })
})
