import type { QueueItem } from '../types'
import { normalizeVolume, type PlayerSettings } from './playerStorage'

interface Buffers { vocals: AudioBuffer; instrumental: AudioBuffer }
export interface PlaybackState { isPlaying: boolean; currentTime: number; duration: number }
interface PlaybackCallbacks {
  onState: (state: PlaybackState) => void
  onTime: (time: number) => void
  onEnded: () => void
  onInit: (analyser: AnalyserNode) => void
}

/** Owns Web Audio resources and cancels obsolete asynchronous loads. */
export class AudioPlayback {
  private context: AudioContext | null = null
  private vocalsGain: GainNode | null = null
  private musicGain: GainNode | null = null
  private sources: AudioBufferSourceNode[] = []
  private buffers: Buffers | null = null
  private generation = 0
  private loading: AbortController | null = null
  private preloadRequest: AbortController | null = null
  private cached: { id: string; buffers: Buffers } | null = null
  private frame: number | null = null
  private offset = 0
  private startedAt = 0
  private playing = false
  private disposed = false
  private settings: PlayerSettings

  private callbacks: PlaybackCallbacks
  constructor(settings: PlayerSettings, callbacks: PlaybackCallbacks) { this.settings = { ...settings }; this.callbacks = callbacks }

  get duration() { return this.buffers ? Math.max(this.buffers.vocals.duration, this.buffers.instrumental.duration) : 0 }
  get currentTime() { return Math.min(this.duration, this.offset + (this.playing && this.context ? this.context.currentTime - this.startedAt : 0)) }
  get hasBuffers() { return this.buffers !== null }
  get isLoading() { return this.loading !== null }
  get isPlaying() { return this.playing }

  private init() {
    if (this.disposed) throw new Error('Player has been disposed')
    if (this.context) return this.context
    const context = new AudioContext()
    this.context = context
    this.vocalsGain = context.createGain()
    this.musicGain = context.createGain()
    this.vocalsGain.connect(context.destination)
    this.musicGain.connect(context.destination)
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    this.vocalsGain.connect(analyser)
    this.musicGain.connect(analyser)
    this.applySettings()
    this.callbacks.onInit(analyser)
    return context
  }

  setSettings(settings: Partial<PlayerSettings>) {
    this.settings = { ...this.settings, ...settings }
    this.applySettings()
  }

  private applySettings() {
    if (this.vocalsGain) this.vocalsGain.gain.value = this.settings.karaokeMode ? 0 : normalizeVolume(this.settings.vocalsVolume) / 100
    if (this.musicGain) this.musicGain.gain.value = normalizeVolume(this.settings.instrumentalVolume) / 100
  }

  private emit() { if (!this.disposed) this.callbacks.onState({ isPlaying: this.playing, currentTime: this.currentTime, duration: this.duration }) }

  private stopSources() {
    for (const source of this.sources) {
      source.onended = null
      try { source.stop() } catch { /* Already stopped. */ }
      source.disconnect()
    }
    this.sources = []
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    this.playing = false
  }

  pause() {
    ++this.generation
    this.loading?.abort()
    this.loading = null
    this.offset = this.currentTime
    this.stopSources()
    this.emit()
  }

  stop() {
    this.pause()
    this.buffers = null
    this.offset = 0
    this.emit()
  }

  private async decode(item: QueueItem, context: AudioContext, signal: AbortSignal): Promise<Buffers> {
    const load = async (url: string) => {
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error('Audio unavailable')
      return context.decodeAudioData(await response.arrayBuffer())
    }
    const [vocals, instrumental] = await Promise.all([load(item.vocalsUrl), load(item.musicUrl)])
    return { vocals, instrumental }
  }

  async load(item: QueueItem): Promise<boolean> {
    this.stop()
    const version = this.generation
    const controller = new AbortController()
    this.loading = controller
    try {
      const context = this.init()
      if (context.state === 'suspended') await context.resume()
      if (version !== this.generation || this.disposed) return false
      const buffers = this.cached?.id === item.id ? this.cached.buffers : await this.decode(item, context, controller.signal)
      if (version !== this.generation || this.disposed) return false
      this.cached = null
      this.buffers = buffers
      this.start(0)
      return true
    } catch (error) {
      if (version !== this.generation || this.disposed || controller.signal.aborted) return false
      this.emit()
      throw error
    } finally {
      if (this.loading === controller) this.loading = null
    }
  }

  /** A Play gesture can release a remote load blocked by autoplay policy. */
  async activate(): Promise<void> {
    if (this.disposed) return
    const context = this.init()
    if (context.state === 'suspended') await context.resume()
  }

  async resume(): Promise<boolean> {
    if (!this.buffers || this.disposed) return false
    const version = this.generation
    const context = this.init()
    if (context.state === 'suspended') await context.resume()
    if (version !== this.generation || this.disposed) return false
    this.start(this.offset >= this.duration ? 0 : this.offset)
    return true
  }

  private start(time: number) {
    if (!this.context || !this.buffers) return
    this.stopSources()
    this.offset = Math.max(0, Math.min(this.duration, time))
    this.startedAt = this.context.currentTime
    const entries = [
      { buffer: this.buffers.vocals, gain: this.vocalsGain! },
      { buffer: this.buffers.instrumental, gain: this.musicGain! },
    ]
    const longest = entries[0].buffer.duration >= entries[1].buffer.duration ? 0 : 1
    this.sources = entries.map(({ buffer, gain }) => {
      const source = this.context!.createBufferSource()
      source.buffer = buffer
      source.connect(gain)
      return source
    })
    this.sources[longest].onended = () => {
      this.offset = this.duration
      this.stopSources()
      this.emit()
      this.callbacks.onEnded()
    }
    this.playing = true
    this.sources.forEach((source, index) => source.start(this.startedAt, Math.min(this.offset, entries[index].buffer.duration)))
    this.emit()
    const tick = () => {
      if (!this.playing || this.disposed) return
      this.callbacks.onTime(this.currentTime)
      if (this.playing && !this.disposed) this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  seek(time: number) {
    if (!this.buffers || !Number.isFinite(time)) return
    const offset = Math.max(0, Math.min(this.duration, time))
    if (this.playing) this.start(offset)
    else { this.offset = offset; this.emit() }
  }

  preload(item?: QueueItem) {
    this.preloadRequest?.abort()
    this.preloadRequest = null
    if (!item || !this.context || this.disposed) { this.cached = null; return }
    if (this.cached?.id === item.id) return
    this.cached = null
    const controller = new AbortController()
    this.preloadRequest = controller
    void this.decode(item, this.context, controller.signal).then(buffers => {
      if (!controller.signal.aborted && !this.disposed) this.cached = { id: item.id, buffers }
    }).catch(() => {}).finally(() => { if (this.preloadRequest === controller) this.preloadRequest = null })
  }

  dispose() {
    this.disposed = true
    this.stop()
    this.preloadRequest?.abort()
    this.cached = null
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {})
    this.context = null
  }
}
