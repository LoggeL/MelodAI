import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioPlayback } from '../AudioPlayback'
import { queueItem } from '../../utils/queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

class FakeContext {
  static instances: FakeContext[] = []
  state: AudioContextState = 'running'
  currentTime = 10
  destination = {}
  gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn> }> = []
  sources: Array<{ buffer: AudioBuffer | null; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }> = []
  resume = vi.fn(async () => {})
  close = vi.fn(async () => { this.state = 'closed' })
  decodeAudioData = vi.fn(async () => ({ duration: 60 } as AudioBuffer))
  constructor() { FakeContext.instances.push(this) }
  createGain() { const gain = { gain: { value: 1 }, connect: vi.fn() }; this.gains.push(gain); return gain }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0 } }
  createBufferSource() {
    const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }
    this.sources.push(source)
    return source
  }
}

const song = (id = '1') => queueItem({ id, title: id, artist: '', thumbnail: '' })
const settings = { vocalsVolume: 50, instrumentalVolume: 50, karaokeMode: false }
const makeCallbacks = () => ({ onState: vi.fn(), onTime: vi.fn(), onEnded: vi.fn(), onInit: vi.fn() })
let callbacks: ReturnType<typeof makeCallbacks>
let player: AudioPlayback

beforeEach(() => {
  FakeContext.instances = []
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8))))
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  callbacks = makeCallbacks()
  player = new AudioPlayback(settings, callbacks)
})
afterEach(() => { player.dispose(); vi.unstubAllGlobals() })

describe('audio lifecycle', () => {
  it('starts both stems on exactly the same audio clock and preserves pre-init settings', async () => {
    player.setSettings({ vocalsVolume: 20, instrumentalVolume: 80 })
    expect(await player.load(song())).toBe(true)
    const context = FakeContext.instances[0]
    expect(context.gains.map(gain => gain.gain.value)).toEqual([0.2, 0.8])
    expect(context.sources.map(source => source.start.mock.calls[0])).toEqual([[10, 0], [10, 0]])
    expect(player.isPlaying).toBe(true)
  })

  it('keeps vocals muted in karaoke mode while remembering the changed level', async () => {
    player.setSettings({ karaokeMode: true, vocalsVolume: 30 })
    await player.load(song())
    const context = FakeContext.instances[0]
    expect(context.gains[0].gain.value).toBe(0)
    player.setSettings({ vocalsVolume: 70 })
    expect(context.gains[0].gain.value).toBe(0)
    player.setSettings({ karaokeMode: false })
    expect(context.gains[0].gain.value).toBe(0.7)
  })

  it('does not start audio when paused while a load is pending', async () => {
    const response = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(response.promise)
    const loading = player.load(song())
    player.pause()
    response.resolve(new Response(new ArrayBuffer(8)))
    expect(await loading).toBe(false)
    expect(FakeContext.instances[0].sources).toHaveLength(0)
    expect(player.isPlaying).toBe(false)
    expect(player.hasBuffers).toBe(false)
  })

  it('does not revive obsolete loads after stop or disposal', async () => {
    const response = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(response.promise)
    const loading = player.load(song())
    player.dispose()
    callbacks.onState.mockClear()
    response.resolve(new Response(new ArrayBuffer(8)))
    expect(await loading).toBe(false)
    expect(FakeContext.instances[0].sources).toHaveLength(0)
    expect(FakeContext.instances[0].close).toHaveBeenCalledOnce()
    expect(callbacks.onState).not.toHaveBeenCalled()
  })

  it('replaces a pending load without letting its late response change the active audio', async () => {
    const response = deferred<Response>()
    vi.mocked(fetch).mockImplementationOnce(() => response.promise).mockImplementationOnce(() => response.promise)
    const old = player.load(song('1'))
    expect(await player.load(song('2'))).toBe(true)
    response.resolve(new Response(new ArrayBuffer(8)))
    expect(await old).toBe(false)
    expect(FakeContext.instances[0].sources).toHaveLength(2)
    expect(player.isPlaying).toBe(true)
  })

  it('does not reuse the previous song after the next song fails', async () => {
    await player.load(song('1'))
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }))
    await expect(player.load(song('2'))).rejects.toThrow('Audio unavailable')
    expect(player.hasBuffers).toBe(false)
    expect(await player.resume()).toBe(false)
    expect(player.isPlaying).toBe(false)
  })

  it('unlocks a pending remote load with the first Play gesture', async () => {
    const permission = deferred<void>()
    class SuspendedContext extends FakeContext {
      constructor() {
        super()
        this.state = 'suspended'
        this.resume.mockImplementationOnce(() => permission.promise).mockImplementationOnce(async () => {
          this.state = 'running'
          permission.resolve()
        })
      }
    }
    vi.stubGlobal('AudioContext', SuspendedContext)
    const loading = player.load(song())
    expect(player.isLoading).toBe(true)
    expect(player.isPlaying).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    await player.activate()
    expect(await loading).toBe(true)
    expect(player.isPlaying).toBe(true)
    expect(FakeContext.instances[0].sources).toHaveLength(2)
    expect(FakeContext.instances[0].resume).toHaveBeenCalledTimes(2)
  })

  it('cancels a suspended-context resume when pause arrives before it resolves', async () => {
    await player.load(song())
    player.pause()
    const context = FakeContext.instances[0]
    context.state = 'suspended'
    const resumed = deferred<void>()
    context.resume.mockReturnValue(resumed.promise)
    const resuming = player.resume()
    player.pause()
    resumed.resolve()
    expect(await resuming).toBe(false)
    expect(context.sources).toHaveLength(2)
  })

  it('resumes from the paused position and clamps invalid seeks', async () => {
    await player.load(song())
    const context = FakeContext.instances[0]
    context.currentTime = 17
    player.pause()
    expect(player.currentTime).toBe(7)
    player.seek(-4)
    expect(player.currentTime).toBe(0)
    player.seek(Number.NaN)
    expect(player.currentTime).toBe(0)
    player.seek(14)
    await player.resume()
    expect(context.sources.slice(2).map(source => source.start.mock.calls[0])).toEqual([[17, 14], [17, 14]])
    player.pause()
    player.seek(999)
    expect(player.currentTime).toBe(60)
  })
})
