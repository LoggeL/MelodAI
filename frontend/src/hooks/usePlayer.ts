import { useState, useRef, useCallback, useEffect } from 'react'
import type { QueueItem, LyricsData } from '../types'
import { tracks } from '../services/api'
import { showToast } from './useToast'
import type { SyncState, SyncCommand } from './useSync'

interface UsePlayerOptions {
  isAdmin?: boolean
  onCreditsUpdate?: (credits: number) => void
}

// localStorage keys
const QUEUE_STORAGE_KEY = 'melodai_queue'
const PLAYER_STORAGE_KEY = 'melodai_player'

interface StoredQueueData {
  items: { id: string; title: string; artist: string; thumbnail: string }[]
  currentIndex: number
}

interface StoredPlayerData {
  vocalsVolume: number
  instrumentalVolume: number
  karaokeMode: boolean
}

function loadStoredQueue(): { queue: QueueItem[]; currentIndex: number } {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
    if (!raw) return { queue: [], currentIndex: -1 }
    const data: StoredQueueData = JSON.parse(raw)
    if (!data.items?.length) return { queue: [], currentIndex: -1 }
    const queue: QueueItem[] = data.items.map(item => ({
      id: item.id,
      title: item.title,
      artist: item.artist,
      thumbnail: item.thumbnail,
      vocalsUrl: `/songs/${item.id}/vocals.mp3`,
      musicUrl: `/songs/${item.id}/no_vocals.mp3`,
      lyricsUrl: `/api/track/${item.id}/lyrics`,
      ready: true,
      progress: 100,
      status: 'ready',
      error: false,
    }))
    const currentIndex = Math.max(-1, Math.min(data.currentIndex, queue.length - 1))
    return { queue, currentIndex }
  } catch {
    return { queue: [], currentIndex: -1 }
  }
}

function loadStoredPlayer(): StoredPlayerData | null {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function usePlayer(options: UsePlayerOptions = {}) {
  const [storedQueue] = useState(loadStoredQueue)
  const [queue, setQueue] = useState<QueueItem[]>(storedQueue.queue)
  const [currentIndex, setCurrentIndex] = useState(storedQueue.currentIndex)
  const [isPlaying, setIsPlaying] = useState(false)
  const [lyrics, setLyrics] = useState<LyricsData | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [karaokeMode, setKaraokeMode] = useState(() => {
    const stored = loadStoredPlayer()
    return stored?.karaokeMode ?? false
  })
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  // Audio context and gain nodes
  const audioCtxRef = useRef<AudioContext | null>(null)
  const vocalsGainRef = useRef<GainNode | null>(null)
  const instrumentalGainRef = useRef<GainNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const initedRef = useRef(false)

  // Decoded audio buffers
  const vocalsBufferRef = useRef<AudioBuffer | null>(null)
  const instBufferRef = useRef<AudioBuffer | null>(null)

  // Source nodes (recreated on each play/seek/resume)
  const vocalsSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const instSourceRef = useRef<AudioBufferSourceNode | null>(null)

  // Timing: track position via AudioContext clock
  const startCtxTimeRef = useRef(0)
  const startOffsetRef = useRef(0)
  const pausedAtRef = useRef(0)
  const isPlayingRef = useRef(false)

  // Buffer cache for preloading next track
  const bufferCacheRef = useRef<Map<string, { vocals: AudioBuffer; instrumental: AudioBuffer }>>(new Map())

  // Version counter to discard stale async loads
  const playVersionRef = useRef(0)

  const animRef = useRef<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const savedVocalsVolRef = useRef(0.5)
  const saveQueueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savePlayerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const storedPlayerData = useRef(loadStoredPlayer())

  // Refs tracking latest state for use in callbacks
  const queueRef = useRef(queue)
  const currentIndexRef = useRef(currentIndex)
  const karaokeModeRef = useRef(karaokeMode)
  queueRef.current = queue
  currentIndexRef.current = currentIndex
  karaokeModeRef.current = karaokeMode

  // Ref for playIndex so onended can call it without circular deps
  const playIndexRef = useRef<(index: number) => void>(() => {})

  // Sync refs — populated by PlayerPage to wire useSync ↔ usePlayer
  const syncSourceRef = useRef(false)
  const syncPushRef = useRef<(() => void) | null>(null)
  const syncCommandRef = useRef<((cmd: string, payload?: Record<string, unknown>) => void) | null>(null)

  // Credit tracking refs
  const creditChargedRef = useRef<Set<string>>(new Set())
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Load favorites on mount
  useEffect(() => {
    tracks.favorites().then(ids => setFavorites(new Set(ids))).catch(() => {})
  }, [])

  // Debounced save queue to localStorage + sync push
  useEffect(() => {
    if (saveQueueTimerRef.current) clearTimeout(saveQueueTimerRef.current)
    saveQueueTimerRef.current = setTimeout(() => {
      const readyItems = queue.filter(q => q.ready)
      if (readyItems.length === 0) {
        localStorage.removeItem(QUEUE_STORAGE_KEY)
        return
      }
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({
        items: readyItems.map(q => ({
          id: q.id, title: q.title, artist: q.artist, thumbnail: q.thumbnail,
        })),
        currentIndex,
      }))
      // Push to sync server (skip if this change originated from sync)
      if (!syncSourceRef.current) {
        syncPushRef.current?.()
      }
      syncSourceRef.current = false
    }, 500)
    return () => { if (saveQueueTimerRef.current) clearTimeout(saveQueueTimerRef.current) }
  }, [queue, currentIndex])

  // Validate restored queue items against server and fetch lyrics for current track
  useEffect(() => {
    if (storedQueue.queue.length === 0) return
    const validateQueue = async () => {
      const validItems: QueueItem[] = []
      for (const item of storedQueue.queue) {
        try {
          const info = await tracks.info(item.id)
          if (info.metadata) {
            item.title = info.metadata.title || item.title
            item.artist = info.metadata.artist || item.artist
            item.thumbnail = info.metadata.img_url || item.thumbnail
            validItems.push(item)
          }
        } catch {
          // Track no longer exists, skip it
        }
      }
      if (validItems.length !== storedQueue.queue.length) {
        const newIndex = storedQueue.currentIndex >= validItems.length
          ? Math.max(validItems.length - 1, -1)
          : storedQueue.currentIndex
        setQueue(validItems)
        setCurrentIndex(validItems.length > 0 ? newIndex : -1)
      }

      // Fetch lyrics for the restored current track so they display without replay
      const ci = storedQueue.currentIndex
      const currentItem = ci >= 0 && ci < validItems.length ? validItems[ci] : (ci >= 0 && ci < storedQueue.queue.length ? storedQueue.queue[ci] : null)
      if (currentItem?.ready) {
        setLyricsLoading(true)
        try {
          const lyricsData = await tracks.lyrics(currentItem.id)
          setLyrics(lyricsData)
        } catch {
          setLyrics(null)
        }
        setLyricsLoading(false)
      }
    }
    validateQueue()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Initialize Web Audio context and gain nodes
  const initAudio = useCallback(() => {
    if (initedRef.current) return
    initedRef.current = true

    const ctx = new AudioContext()
    audioCtxRef.current = ctx

    const stored = storedPlayerData.current
    const vGain = ctx.createGain()
    const iGain = ctx.createGain()
    vGain.connect(ctx.destination)
    iGain.connect(ctx.destination)
    const vVol = stored ? stored.vocalsVolume / 100 : 0.5
    const iVol = stored ? stored.instrumentalVolume / 100 : 0.5
    vGain.gain.value = stored?.karaokeMode ? 0 : vVol
    iGain.gain.value = iVol
    savedVocalsVolRef.current = vVol

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    vGain.connect(analyser)
    iGain.connect(analyser)
    analyserRef.current = analyser

    vocalsGainRef.current = vGain
    instrumentalGainRef.current = iGain

    // Animation frame loop for time tracking
    const tick = () => {
      if (isPlayingRef.current && audioCtxRef.current) {
        const elapsed = audioCtxRef.current.currentTime - startCtxTimeRef.current
        const t = startOffsetRef.current + elapsed
        setCurrentTime(t)

        // Credit deduction at 15s
        if (t >= 15 && !optionsRef.current.isAdmin) {
          const q = queueRef.current
          const ci = currentIndexRef.current
          const currentItem = ci >= 0 ? q[ci] : null
          if (currentItem && !creditChargedRef.current.has(currentItem.id)) {
            creditChargedRef.current.add(currentItem.id)
            tracks.deductPlayCredit(currentItem.id).then(data => {
              if (data.credits !== undefined && optionsRef.current.onCreditsUpdate) {
                optionsRef.current.onCreditsUpdate(data.credits)
              }
            }).catch(() => {})
          }
        }
      }
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
  }, [])

  // Cleanup: stop all audio on unmount
  useEffect(() => {
    return () => {
      try { vocalsSourceRef.current?.stop() } catch { /* already stopped */ }
      try { instSourceRef.current?.stop() } catch { /* already stopped */ }
      vocalsSourceRef.current = null
      instSourceRef.current = null
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close()
      }
      if (animRef.current) cancelAnimationFrame(animRef.current)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // Start both buffers at the exact same AudioContext time (sample-accurate sync)
  const startPlayback = useCallback((offset = 0) => {
    const ctx = audioCtxRef.current
    if (!ctx || !vocalsBufferRef.current || !instBufferRef.current) return

    // Stop existing sources (onended will bail via ref check)
    try { vocalsSourceRef.current?.stop() } catch { /* already stopped */ }
    try { instSourceRef.current?.stop() } catch { /* already stopped */ }
    vocalsSourceRef.current = null
    instSourceRef.current = null

    const vSrc = ctx.createBufferSource()
    const iSrc = ctx.createBufferSource()
    vSrc.buffer = vocalsBufferRef.current
    iSrc.buffer = instBufferRef.current
    vSrc.connect(vocalsGainRef.current!)
    iSrc.connect(instrumentalGainRef.current!)

    startCtxTimeRef.current = ctx.currentTime
    startOffsetRef.current = offset

    // Both start at the same context time — can never desync
    vSrc.start(0, offset)
    iSrc.start(0, offset)

    vocalsSourceRef.current = vSrc
    instSourceRef.current = iSrc
    isPlayingRef.current = true

    // Auto-advance when song ends naturally
    vSrc.onended = () => {
      if (vocalsSourceRef.current !== vSrc) return
      isPlayingRef.current = false
      setIsPlaying(false)

      const q = queueRef.current
      const ci = currentIndexRef.current
      if (q.length === 0) return
      let idx = ci + 1
      if (idx >= q.length) idx = 0
      for (let i = 0; i < q.length; i++) {
        if (q[idx]?.ready) {
          playIndexRef.current(idx)
          return
        }
        idx = (idx + 1) % q.length
      }
    }
  }, [])

  // Fetch and decode audio buffers (uses cache if available)
  const loadBuffers = useCallback(async (item: QueueItem): Promise<{ vocals: AudioBuffer; instrumental: AudioBuffer }> => {
    const ctx = audioCtxRef.current!
    const cached = bufferCacheRef.current.get(item.id)
    if (cached) {
      bufferCacheRef.current.delete(item.id)
      return cached
    }

    const [vocalsData, instData] = await Promise.all([
      fetch(item.vocalsUrl).then(r => r.arrayBuffer()),
      fetch(item.musicUrl).then(r => r.arrayBuffer()),
    ])
    const [vocals, instrumental] = await Promise.all([
      ctx.decodeAudioData(vocalsData),
      ctx.decodeAudioData(instData),
    ])
    return { vocals, instrumental }
  }, [])

  // Preload next song's buffers
  useEffect(() => {
    const q = queueRef.current
    const ci = currentIndexRef.current
    if (ci < 0 || q.length < 2 || !audioCtxRef.current) return

    let nextIdx = ci + 1
    if (nextIdx >= q.length) nextIdx = 0
    const nextItem = q[nextIdx]
    if (!nextItem?.ready || nextIdx === ci) return
    if (bufferCacheRef.current.has(nextItem.id)) return

    const ctx = audioCtxRef.current
    Promise.all([
      fetch(nextItem.vocalsUrl).then(r => r.arrayBuffer()),
      fetch(nextItem.musicUrl).then(r => r.arrayBuffer()),
    ]).then(([vData, iData]) =>
      Promise.all([ctx.decodeAudioData(vData), ctx.decodeAudioData(iData)])
    ).then(([vocals, instrumental]) => {
      bufferCacheRef.current.set(nextItem.id, { vocals, instrumental })
    }).catch(() => {})
  }, [currentIndex, queue])

  // Status polling
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const pending = queueRef.current.filter(q => !q.ready && !q.error)
      if (pending.length === 0) return

      let changed = false
      for (const item of pending) {
        try {
          const data = await tracks.status(item.id) as { status: string; progress: number; detail?: string }
          if (data.status === 'complete' || data.progress >= 100) {
            item.ready = true
            item.progress = 100
            item.status = 'ready'
            changed = true
            if (item.title === 'Loading...') {
              const info = await tracks.info(item.id)
              if (info.metadata) {
                item.title = info.metadata.title || item.title
                item.artist = info.metadata.artist || item.artist
                item.thumbnail = info.metadata.img_url || item.thumbnail
              }
            }
            if (currentIndexRef.current < 0) {
              const idx = queueRef.current.indexOf(item)
              if (idx >= 0) playIndexRef.current(idx)
            }
          } else if (data.status === 'error') {
            item.error = true
            item.status = 'error'
            item.progress = 0
            changed = true
          } else {
            item.progress = data.progress || 0
            item.status = data.detail || data.status || 'processing'
            changed = true
          }
        } catch { /* ignore */ }
      }
      if (changed) setQueue([...queueRef.current])
    }, 5000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const addToQueue = useCallback(async (trackId: string, meta?: { title?: string; artist?: string; img_url?: string }, autoPlay?: boolean) => {
    initAudio()

    if (queueRef.current.find(q => q.id === trackId)) {
      if (autoPlay) {
        const idx = queueRef.current.findIndex(q => q.id === trackId)
        if (idx >= 0 && queueRef.current[idx].ready) {
          playIndexRef.current(idx)
        }
      } else {
        showToast('Song already in queue', 'warning')
      }
      return
    }

    const item: QueueItem = {
      id: trackId,
      title: meta?.title || 'Loading...',
      artist: meta?.artist || '',
      thumbnail: meta?.img_url || '',
      vocalsUrl: `/songs/${trackId}/vocals.mp3`,
      musicUrl: `/songs/${trackId}/no_vocals.mp3`,
      lyricsUrl: `/api/track/${trackId}/lyrics`,
      ready: false,
      progress: 0,
      status: 'processing',
      error: false,
    }

    const newQueue = [...queueRef.current, item]
    queueRef.current = newQueue
    setQueue(newQueue)
    showToast(`Added "${item.title}" to queue`, 'success')

    try {
      const data = await tracks.add(trackId)

      if (data.error === 'insufficient_credits') {
        showToast(`Not enough credits (need ${data.required ?? 5}, have ${data.credits ?? 0})`, 'error')
        const filtered = queueRef.current.filter(q => q.id !== trackId)
        queueRef.current = filtered
        setQueue(filtered)
        return
      }

      if (data.status === 'ready') {
        item.ready = true
        item.progress = 100
        item.status = 'ready'
      }
      if (data.metadata) {
        item.title = data.metadata.title || item.title
        item.artist = data.metadata.artist || item.artist
        item.thumbnail = data.metadata.img_url || item.thumbnail
      }
      if (data.credits !== undefined && optionsRef.current.onCreditsUpdate) {
        optionsRef.current.onCreditsUpdate(data.credits)
      }
    } catch {
      item.error = true
      item.status = 'error'
      showToast('Failed to add song', 'error')
    }

    setQueue([...queueRef.current])

    if (item.ready && autoPlay) {
      const idx = queueRef.current.indexOf(item)
      if (idx >= 0) playIndexRef.current(idx)
    }
  }, [initAudio])

  const playIndex = useCallback(async (index: number) => {
    initAudio()
    const q = queueRef.current
    if (index < 0 || index >= q.length) return
    const item = q[index]
    if (!item.ready) return

    if (!syncSourceRef.current) syncCommandRef.current?.('playIndex', { index })

    if (audioCtxRef.current?.state === 'suspended') {
      await audioCtxRef.current.resume()
    }

    // Stop current playback
    try { vocalsSourceRef.current?.stop() } catch { /* */ }
    try { instSourceRef.current?.stop() } catch { /* */ }
    vocalsSourceRef.current = null
    instSourceRef.current = null
    isPlayingRef.current = false

    const version = ++playVersionRef.current
    setCurrentIndex(index)
    setLyrics(null)
    setLyricsLoading(true)
    setCurrentTime(0)

    try {
      const { vocals, instrumental } = await loadBuffers(item)
      if (playVersionRef.current !== version) return

      vocalsBufferRef.current = vocals
      instBufferRef.current = instrumental
      setDuration(Math.max(vocals.duration, instrumental.duration))

      if (karaokeModeRef.current && vocalsGainRef.current) {
        vocalsGainRef.current.gain.value = 0
      }

      startPlayback(0)
      setIsPlaying(true)
    } catch {
      showToast('Failed to load audio', 'error')
    }

    try {
      const lyricsData = await tracks.lyrics(item.id)
      if (playVersionRef.current === version) setLyrics(lyricsData)
    } catch {
      if (playVersionRef.current === version) setLyrics(null)
    }
    if (playVersionRef.current === version) setLyricsLoading(false)

    tracks.logPlay(item.id)
  }, [initAudio, loadBuffers, startPlayback])

  // Keep ref in sync so onended / polling can call playIndex
  playIndexRef.current = playIndex

  const togglePlay = useCallback(() => {
    if (currentIndexRef.current < 0) return
    if (isPlaying) {
      // Pause: record position, stop sources
      if (audioCtxRef.current) {
        const elapsed = audioCtxRef.current.currentTime - startCtxTimeRef.current
        pausedAtRef.current = startOffsetRef.current + elapsed
      }
      try { vocalsSourceRef.current?.stop() } catch { /* */ }
      try { instSourceRef.current?.stop() } catch { /* */ }
      vocalsSourceRef.current = null
      instSourceRef.current = null
      isPlayingRef.current = false
      setIsPlaying(false)
      if (!syncSourceRef.current) syncCommandRef.current?.('pause')
    } else {
      // If buffers aren't loaded yet (e.g. restored from localStorage), do a full playIndex
      if (!vocalsBufferRef.current || !instBufferRef.current) {
        playIndex(currentIndexRef.current)
        return
      }
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume()
      startPlayback(pausedAtRef.current)
      setIsPlaying(true)
      if (!syncSourceRef.current) syncCommandRef.current?.('play')
    }
  }, [isPlaying, startPlayback, playIndex])

  const seek = useCallback((time: number) => {
    if (!audioCtxRef.current || !vocalsBufferRef.current) return
    if (isPlayingRef.current) {
      startPlayback(time)
    } else {
      pausedAtRef.current = time
      setCurrentTime(time)
    }
    if (!syncSourceRef.current) syncCommandRef.current?.('seek', { time })
  }, [startPlayback])

  const prev = useCallback(() => {
    const q = queueRef.current
    if (q.length === 0) return
    let idx = currentIndexRef.current - 1
    if (idx < 0) idx = q.length - 1
    for (let i = 0; i < q.length; i++) {
      if (q[idx]?.ready) { playIndex(idx); return }
      idx = idx - 1 < 0 ? q.length - 1 : idx - 1
    }
  }, [playIndex])

  const next = useCallback(() => {
    const q = queueRef.current
    if (q.length === 0) return
    let idx = currentIndexRef.current + 1
    if (idx >= q.length) idx = 0
    for (let i = 0; i < q.length; i++) {
      if (q[idx]?.ready) { playIndex(idx); return }
      idx = (idx + 1) % q.length
    }
  }, [playIndex])

  const removeFromQueue = useCallback((index: number) => {
    if (index === currentIndexRef.current) return
    const newQueue = [...queueRef.current]
    newQueue.splice(index, 1)
    setQueue(newQueue)
    if (index < currentIndexRef.current) {
      setCurrentIndex(prev => prev - 1)
    }
  }, [])

  const savePlayerState = useCallback(() => {
    if (savePlayerTimerRef.current) clearTimeout(savePlayerTimerRef.current)
    savePlayerTimerRef.current = setTimeout(() => {
      localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify({
        vocalsVolume: Math.round(savedVocalsVolRef.current * 100),
        instrumentalVolume: Math.round((instrumentalGainRef.current?.gain.value ?? 0.5) * 100),
        karaokeMode: karaokeModeRef.current,
      }))
    }, 500)
  }, [])

  const setVocalsVolume = useCallback((v: number) => {
    savedVocalsVolRef.current = v / 100
    if (vocalsGainRef.current && !karaokeModeRef.current) {
      vocalsGainRef.current.gain.value = v / 100
    }
    savePlayerState()
  }, [savePlayerState])

  const setInstrumentalVolume = useCallback((v: number) => {
    if (instrumentalGainRef.current) instrumentalGainRef.current.gain.value = v / 100
    savePlayerState()
  }, [savePlayerState])

  const toggleKaraokeMode = useCallback(() => {
    setKaraokeMode(prev => {
      const newMode = !prev
      if (vocalsGainRef.current) {
        if (newMode) {
          savedVocalsVolRef.current = vocalsGainRef.current.gain.value
          vocalsGainRef.current.gain.value = 0
        } else {
          vocalsGainRef.current.gain.value = savedVocalsVolRef.current
        }
      }
      showToast(newMode ? 'Karaoke mode: vocals muted' : 'Vocals restored', 'success')
      return newMode
    })
    savePlayerState()
  }, [savePlayerState])

  const toggleFavorite = useCallback(async (trackId: string) => {
    const isFav = favorites.has(trackId)
    try {
      if (isFav) {
        await tracks.removeFavorite(trackId)
        setFavorites(prev => { const next = new Set(prev); next.delete(trackId); return next })
      } else {
        await tracks.addFavorite(trackId)
        setFavorites(prev => new Set(prev).add(trackId))
      }
    } catch {
      showToast('Failed to update favorite', 'error')
    }
  }, [favorites])

  const editWord = useCallback(async (segIdx: number, wordIdx: number, newWord: string) => {
    const track = queueRef.current[currentIndexRef.current]
    if (!track) return
    try {
      await tracks.editWord(track.id, { segmentIndex: segIdx, wordIndex: wordIdx, word: newWord })
      setLyrics(prev => {
        if (!prev) return prev
        const updated = JSON.parse(JSON.stringify(prev))
        updated.segments[segIdx].words[wordIdx].word = newWord
        return updated
      })
      showToast('Word updated', 'success')
    } catch {
      showToast('Failed to update word', 'error')
    }
  }, [])

  const shuffle = useCallback(() => {
    const q = [...queueRef.current]
    if (q.length < 2) return
    const current = currentIndexRef.current >= 0 ? q[currentIndexRef.current] : null
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]]
    }
    setQueue(q)
    if (current) setCurrentIndex(q.indexOf(current))
    showToast('Queue shuffled', 'success')
  }, [])

  const clearQueue = useCallback(() => {
    const current = currentIndexRef.current >= 0 ? queueRef.current[currentIndexRef.current] : null
    setQueue(current ? [current] : [])
    setCurrentIndex(current ? 0 : -1)
    if (!current) localStorage.removeItem(QUEUE_STORAGE_KEY)
    showToast('Queue cleared', 'success')
  }, [])

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    const q = [...queueRef.current]
    const [moved] = q.splice(fromIndex, 1)
    q.splice(toIndex, 0, moved)
    setQueue(q)

    let newCurrent = currentIndexRef.current
    if (currentIndexRef.current === fromIndex) {
      newCurrent = toIndex
    } else if (fromIndex < currentIndexRef.current && toIndex >= currentIndexRef.current) {
      newCurrent--
    } else if (fromIndex > currentIndexRef.current && toIndex <= currentIndexRef.current) {
      newCurrent++
    }
    setCurrentIndex(newCurrent)
  }, [])

  const retryTrack = useCallback(async (index: number) => {
    const item = queueRef.current[index]
    if (!item) return
    item.error = false
    item.progress = 0
    item.status = 'processing'
    setQueue([...queueRef.current])
    await tracks.add(item.id)
  }, [])

  // Apply incoming sync state from another device
  const applySyncState = useCallback((state: SyncState) => {
    syncSourceRef.current = true
    const newQueue: QueueItem[] = state.queue.map(item => ({
      id: item.id,
      title: item.title,
      artist: item.artist,
      thumbnail: item.thumbnail,
      vocalsUrl: `/songs/${item.id}/vocals.mp3`,
      musicUrl: `/songs/${item.id}/no_vocals.mp3`,
      lyricsUrl: `/api/track/${item.id}/lyrics`,
      ready: true,
      progress: 100,
      status: 'ready',
      error: false,
    }))
    queueRef.current = newQueue
    setQueue(newQueue)
    setCurrentIndex(state.currentIndex)

    // If current track changed, load and play it
    const currentItem = currentIndexRef.current >= 0 ? queueRef.current[currentIndexRef.current] : null
    const newItem = state.currentIndex >= 0 ? newQueue[state.currentIndex] : null
    if (newItem && newItem.id !== currentItem?.id) {
      playIndex(state.currentIndex)
    } else if (state.isPlaying && !isPlayingRef.current && newItem) {
      // Same track but should be playing
      if (vocalsBufferRef.current && instBufferRef.current) {
        if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume()
        startPlayback(pausedAtRef.current)
        setIsPlaying(true)
      } else {
        playIndex(state.currentIndex)
      }
    } else if (!state.isPlaying && isPlayingRef.current) {
      // Should be paused
      if (audioCtxRef.current) {
        const elapsed = audioCtxRef.current.currentTime - startCtxTimeRef.current
        pausedAtRef.current = startOffsetRef.current + elapsed
      }
      try { vocalsSourceRef.current?.stop() } catch { /* */ }
      try { instSourceRef.current?.stop() } catch { /* */ }
      vocalsSourceRef.current = null
      instSourceRef.current = null
      isPlayingRef.current = false
      setIsPlaying(false)
    }
  }, [playIndex, startPlayback])

  // Apply incoming sync command from another device
  const applySyncCommand = useCallback((cmd: SyncCommand) => {
    syncSourceRef.current = true
    switch (cmd.command) {
      case 'play':
        if (!isPlayingRef.current && currentIndexRef.current >= 0) {
          if (!vocalsBufferRef.current || !instBufferRef.current) {
            playIndex(currentIndexRef.current)
          } else {
            if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume()
            startPlayback(pausedAtRef.current)
            setIsPlaying(true)
          }
        }
        break
      case 'pause':
        if (isPlayingRef.current) {
          if (audioCtxRef.current) {
            const elapsed = audioCtxRef.current.currentTime - startCtxTimeRef.current
            pausedAtRef.current = startOffsetRef.current + elapsed
          }
          try { vocalsSourceRef.current?.stop() } catch { /* */ }
          try { instSourceRef.current?.stop() } catch { /* */ }
          vocalsSourceRef.current = null
          instSourceRef.current = null
          isPlayingRef.current = false
          setIsPlaying(false)
        }
        break
      case 'next':
        next()
        break
      case 'prev':
        prev()
        break
      case 'seek': {
        const time = (cmd.payload as { time?: number }).time
        if (time !== undefined) {
          if (isPlayingRef.current) {
            startPlayback(time)
          } else {
            pausedAtRef.current = time
            setCurrentTime(time)
          }
        }
        break
      }
      case 'playIndex': {
        const index = (cmd.payload as { index?: number }).index
        if (index !== undefined) playIndex(index)
        break
      }
    }
  }, [playIndex, startPlayback, next, prev])

  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null
  const initialVocalsVolume = storedPlayerData.current ? storedPlayerData.current.vocalsVolume : 50
  const initialInstrumentalVolume = storedPlayerData.current ? storedPlayerData.current.instrumentalVolume : 50

  return {
    queue, currentIndex, currentTrack, isPlaying, lyrics, lyricsLoading,
    currentTime, duration, karaokeMode, favorites, analyserRef,
    initialVocalsVolume, initialInstrumentalVolume,
    addToQueue, playIndex, togglePlay, seek, prev, next,
    removeFromQueue, setVocalsVolume, setInstrumentalVolume,
    toggleKaraokeMode, toggleFavorite, editWord,
    shuffle, clearQueue, reorderQueue, retryTrack,
    // Sync integration
    syncPushRef, syncCommandRef, applySyncState, applySyncCommand,
  }
}
