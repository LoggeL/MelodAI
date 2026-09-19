import { useState, useRef, useCallback, useEffect } from 'react'
import type { QueueItem, LyricsData, TrackMetadata } from '../types'
import { adjacentReadyIndex, queueItem, queueSnapshot, restoreQueue, selectById, type QueueSelection } from '../utils/queue'
import { tracks, ApiError } from '../services/api'
import { showToast } from './useToast'
import type { SyncState, SyncCommand } from './useSync'
import { isValidTrackId, normalizeTrackId } from '../utils/trackId'
import { AudioPlayback, type PlaybackState } from './AudioPlayback'
import { loadPlayerSettings, loadStoredQueue, normalizeVolume, PLAYER_STORAGE_KEY, queueStorageKey } from './playerStorage'

interface UsePlayerOptions {
  accountKey?: string
  isAdmin?: boolean
  onCreditsUpdate?: (credits: number) => void
}

function withMetadata(item: QueueItem, metadata?: Partial<TrackMetadata>): QueueItem {
  return metadata ? { ...item, title: metadata.title || item.title, artist: metadata.artist || item.artist, thumbnail: metadata.img_url || item.thumbnail } : item
}

export function usePlayer(options: UsePlayerOptions = {}) {
  const [storedQueue] = useState(() => loadStoredQueue(options.accountKey))
  const [selection, setSelection] = useState<QueueSelection>(storedQueue)
  const { queue, currentIndex } = selection
  const [playback, setPlayback] = useState<PlaybackState>({ isPlaying: false, currentTime: 0, duration: 0 })
  const [lyrics, setLyrics] = useState<LyricsData | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [settings, setSettings] = useState(loadPlayerSettings)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const settingsRef = useRef(settings)
  const favoritesRef = useRef(favorites)
  const selectionRef = useRef(selection)
  const optionsRef = useRef(options)
  optionsRef.current = options
  favoritesRef.current = favorites
  const audioRef = useRef<AudioPlayback | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mountedRef = useRef(true)
  const lyricsVersionRef = useRef(0)
  const lyricsTrackRef = useRef<string | null>(null)
  const playbackVersionRef = useRef(0)
  const pendingAutoplayRef = useRef<string | null>(null)
  const trackRequestsRef = useRef(new Set<string>())
  const favoritePendingRef = useRef(new Set<string>())
  const chargedRef = useRef(new Set<string>())
  const chargingRef = useRef(new Set<string>())
  const creditFailureRef = useRef(new Set<string>())
  const remotePlaybackRef = useRef(false)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncPushRef = useRef<(() => void) | null>(null)
  const syncCommandRef = useRef<((cmd: string, payload?: Record<string, unknown>) => void) | null>(null)
  const syncPlaybackIntentRef = useRef<(() => void) | null>(null)
  const playIndexRef = useRef<(index: number, remote?: boolean) => Promise<void>>(async () => {})
  const onTimeRef = useRef<(time: number) => void>(() => {})

  // Publish after React has committed the new queue/playback state to PlayerPage.
  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => { if (mountedRef.current) syncPushRef.current?.() }, 100)
  }, [])

  const replaceSelection = useCallback((next: QueueSelection, remote = false) => {
    selectionRef.current = next
    setSelection(next)
    if (!remote) scheduleSync()
  }, [scheduleSync])

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new AudioPlayback(settingsRef.current, {
        onInit: analyser => { analyserRef.current = analyser },
        onState: state => {
          if (!mountedRef.current) return
          setPlayback(state)
          if (!remotePlaybackRef.current) scheduleSync()
        },
        onTime: time => onTimeRef.current(time),
        onEnded: () => {
          const state = selectionRef.current
          const next = adjacentReadyIndex(state.queue, state.currentIndex, 1)
          if (next >= 0) {
            const pending = pendingAutoplayRef.current
            void playIndexRef.current(next, remotePlaybackRef.current)
            pendingAutoplayRef.current = pending
          }
        },
      })
    }
    return audioRef.current
  }, [scheduleSync])

  const invalidatePendingWork = useCallback(() => {
    lyricsVersionRef.current++
    playbackVersionRef.current++
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      invalidatePendingWork()
      audioRef.current?.dispose()
      audioRef.current = null
      analyserRef.current = null
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    }
  }, [invalidatePendingWork])

  const loadLyrics = useCallback(async (id: string) => {
    const version = ++lyricsVersionRef.current
    lyricsTrackRef.current = id
    setLyrics(null)
    setLyricsLoading(true)
    try {
      const data = await tracks.lyrics(id)
      if (mountedRef.current && lyricsVersionRef.current === version) setLyrics(data)
    } catch {
      if (mountedRef.current && lyricsVersionRef.current === version) setLyrics(null)
    } finally {
      if (mountedRef.current && lyricsVersionRef.current === version) setLyricsLoading(false)
    }
  }, [])

  const clearLyrics = useCallback(() => {
    ++lyricsVersionRef.current
    lyricsTrackRef.current = null
    setLyrics(null)
    setLyricsLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void tracks.favorites().then(ids => {
      if (!cancelled) { favoritesRef.current = new Set(ids); setFavorites(favoritesRef.current) }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const key = queueStorageKey(options.accountKey)
    if (!key) return
    const snapshot = queueSnapshot(queue, currentIndex)
    try {
      if (snapshot.items.length) localStorage.setItem(key, JSON.stringify(snapshot))
      else localStorage.removeItem(key)
    } catch { /* Storage is optional. */ }
  }, [queue, currentIndex, options.accountKey])

  useEffect(() => {
    try { localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(settings)) } catch { /* Storage is optional. */ }
  }, [settings])

  // Reconcile restored rows by identity so responses cannot erase edits made meanwhile.
  useEffect(() => {
    let cancelled = false
    void Promise.all(storedQueue.queue.map(async item => {
      try { return { item, info: await tracks.info(item.id) } }
      catch (error) { return { item, missing: error instanceof ApiError && error.status === 404 } }
    })).then(results => {
      if (cancelled) return
      const current = selectionRef.current
      const selectedId = current.queue[current.currentIndex]?.id
      const nextQueue = current.queue.flatMap(item => {
        const result = results.find(result => result.item === item)
        if (!result) return [item]
        if (result.missing) return []
        if (!result.info) return [item]
        return [{ ...withMetadata(item, result.info.metadata), ready: result.info.complete, progress: result.info.complete ? 100 : result.info.status?.progress ?? 0, status: result.info.complete ? 'ready' : result.info.status?.status || 'processing' }]
      })
      replaceSelection(selectById(nextQueue, selectedId), true)
      const restoredCurrent = nextQueue.find(item => item.id === selectedId)
      if (restoredCurrent?.ready && playbackVersionRef.current === 0 && lyricsTrackRef.current !== restoredCurrent.id) void loadLyrics(restoredCurrent.id)
    })
    return () => { cancelled = true }
  }, [storedQueue, replaceSelection, loadLyrics])

  const playIndex = useCallback(async (index: number, remote = false) => {
    const state = selectionRef.current
    const item = state.queue[index]
    if (!Number.isInteger(index) || !item?.ready || item.error) return
    if (!remote) syncPlaybackIntentRef.current?.()
    remotePlaybackRef.current = remote
    pendingAutoplayRef.current = null
    creditFailureRef.current.delete(item.id)
    const version = ++playbackVersionRef.current
    replaceSelection({ queue: state.queue, currentIndex: index }, true)
    void loadLyrics(item.id)
    try {
      const started = await getAudio().load(item)
      if (!mountedRef.current || playbackVersionRef.current !== version) return
      if (started) {
        void tracks.logPlay(item.id)
        if (!remote) scheduleSync()
      }
    } catch {
      if (mountedRef.current && playbackVersionRef.current === version) showToast('Failed to load audio. Try playing the song again.', 'error')
    }
  }, [getAudio, loadLyrics, replaceSelection, scheduleSync])
  playIndexRef.current = playIndex

  const pause = useCallback((remote = false) => {
    remotePlaybackRef.current = remote
    ++playbackVersionRef.current
    pendingAutoplayRef.current = null
    audioRef.current?.pause()
    if (!remote) scheduleSync()
  }, [scheduleSync])

  const resume = useCallback(async (remote = false) => {
    const state = selectionRef.current
    if (state.currentIndex < 0) return
    const item = state.queue[state.currentIndex]
    if (!item?.ready || item.error) return
    if (!remote) syncPlaybackIntentRef.current?.()
    remotePlaybackRef.current = remote
    creditFailureRef.current.delete(item.id)
    const audio = getAudio()
    if (!audio.hasBuffers) { await playIndex(state.currentIndex, remote); return }
    try {
      if (await audio.resume() && !remote) scheduleSync()
    } catch { showToast('Playback could not start. Try again.', 'error') }
  }, [getAudio, playIndex, scheduleSync])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (audio?.isPlaying) pause()
    else if (audio?.isLoading) {
      // The button says Play while an automatic remote load awaits activation.
      // Resuming its context must retain that load instead of cancelling it.
      syncPlaybackIntentRef.current?.()
      remotePlaybackRef.current = false
      void audio.activate().catch(() => showToast('Playback could not start. Try again.', 'error'))
    } else void resume()
  }, [pause, resume])

  onTimeRef.current = time => {
    if (!mountedRef.current) return
    setPlayback(previous => ({ ...previous, currentTime: time }))
    const state = selectionRef.current
    const item = state.queue[state.currentIndex]
    if (time < 15 || optionsRef.current.isAdmin || !item || chargedRef.current.has(item.id) || chargingRef.current.has(item.id) || creditFailureRef.current.has(item.id)) return
    chargingRef.current.add(item.id)
    void tracks.deductPlayCredit(item.id).then(data => {
      if (!mountedRef.current) return
      if (data.error) throw new ApiError(data.error, 403, data)
      chargedRef.current.add(item.id)
      if (data.credits !== undefined) optionsRef.current.onCreditsUpdate?.(data.credits)
    }).catch(error => {
      if (!mountedRef.current) return
      creditFailureRef.current.add(item.id)
      const active = selectionRef.current.queue[selectionRef.current.currentIndex]
      if (active?.id === item.id) pause()
      if (error instanceof ApiError && typeof error.data.credits === 'number') optionsRef.current.onCreditsUpdate?.(error.data.credits)
      showToast(error instanceof ApiError && error.data.error === 'insufficient_credits' ? 'Not enough credits to continue playback.' : 'Could not verify your play credit. Playback paused; try again.', 'error')
    }).finally(() => chargingRef.current.delete(item.id))
  }

  useEffect(() => {
    const audio = audioRef.current
    const next = adjacentReadyIndex(queue, currentIndex, 1)
    audio?.preload(next >= 0 && next !== currentIndex ? queue[next] : undefined)
    return () => audio?.preload()
  }, [queue, currentIndex, playback.isPlaying])

  const updateItem = useCallback((original: QueueItem, updated: QueueItem) => {
    const current = selectionRef.current
    if (!current.queue.includes(original)) return false
    replaceSelection({ ...current, queue: current.queue.map(item => item === original ? updated : item) })
    return true
  }, [replaceSelection])

  const maybeAutoplay = useCallback((id: string) => {
    if (pendingAutoplayRef.current !== id) return
    const index = selectionRef.current.queue.findIndex(item => item.id === id && item.ready && !item.error)
    if (index >= 0) void playIndexRef.current(index)
  }, [])

  // One poll at a time; removed/retried rows cannot be resurrected by old responses.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const pending = selectionRef.current.queue.filter(item => !item.ready && !item.error && !trackRequestsRef.current.has(item.id))
      await Promise.all(pending.map(async item => {
        try {
          const status = await tracks.status(item.id) as { status: string; progress: number; detail?: string }
          if (cancelled) return
          let updated = { ...item }
          if (status.status === 'error') updated = { ...item, error: true, progress: 0, status: 'error' }
          else if (status.status === 'complete' || status.progress >= 100) {
            updated = { ...item, ready: true, progress: 100, status: 'ready' }
            try { updated = withMetadata(updated, (await tracks.info(item.id)).metadata) } catch { /* Metadata can retry later. */ }
          } else updated = { ...item, progress: status.progress || 0, status: status.detail || status.status || 'processing' }
          if (!cancelled && updateItem(item, updated)) maybeAutoplay(item.id)
        } catch { /* The next poll retries safe reads. */ }
      }))
      if (!cancelled) timer = setTimeout(poll, 5000)
    }
    timer = setTimeout(poll, 5000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [updateItem, maybeAutoplay])

  const requestTrack = useCallback(async (item: QueueItem) => {
    if (trackRequestsRef.current.has(item.id)) return
    trackRequestsRef.current.add(item.id)
    try {
      const data = await tracks.add(item.id)
      if (!mountedRef.current) return
      if (data.error) throw new ApiError(data.error, 400, data)
      const updated = withMetadata({ ...item, ready: data.status === 'ready', progress: data.status === 'ready' ? 100 : data.progress || 0, status: data.status === 'ready' ? 'ready' : 'processing', error: false }, data.metadata)
      if (data.credits !== undefined) optionsRef.current.onCreditsUpdate?.(data.credits)
      if (updateItem(item, updated)) maybeAutoplay(item.id)
    } catch (error) {
      if (!mountedRef.current) return
      if (!updateItem(item, { ...item, ready: false, error: true, status: 'error', progress: 0 })) return
      if (pendingAutoplayRef.current === item.id) pendingAutoplayRef.current = null
      showToast(error instanceof ApiError && error.data.error === 'insufficient_credits' ? `Not enough credits (need ${error.data.required ?? 5}, have ${error.data.credits ?? 0})` : error instanceof Error ? error.message : 'Failed to add song', 'error')
    } finally { trackRequestsRef.current.delete(item.id) }
  }, [updateItem, maybeAutoplay])

  const addToQueue = useCallback(async (trackId: string, meta?: { title?: string; artist?: string; img_url?: string | null }, autoPlay?: boolean) => {
    if (!isValidTrackId(trackId)) { showToast('Invalid track ID', 'error'); return }
    // Mark before /add resolves, while the previous song can still be selected.
    if (autoPlay) syncPlaybackIntentRef.current?.()
    const id = normalizeTrackId(trackId)
    const current = selectionRef.current
    const existingIndex = current.queue.findIndex(item => item.id === id)
    if (existingIndex >= 0) {
      if (autoPlay) {
        pendingAutoplayRef.current = id
        maybeAutoplay(id)
      } else showToast('Song already in queue', 'warning')
      return
    }
    const item = queueItem({ id, title: meta?.title || 'Loading...', artist: meta?.artist || '', thumbnail: meta?.img_url || '' }, false)
    if (autoPlay) pendingAutoplayRef.current = id
    replaceSelection({ ...current, queue: [...current.queue, item] })
    showToast(`Added "${item.title}" to queue`, 'success')
    await requestTrack(item)
  }, [replaceSelection, requestTrack, maybeAutoplay])

  const removeFromQueue = useCallback((index: number) => {
    const current = selectionRef.current
    if (!Number.isInteger(index) || !current.queue[index] || index === current.currentIndex) return
    const id = current.queue[index].id
    if (pendingAutoplayRef.current === id) pendingAutoplayRef.current = null
    replaceSelection(selectById(current.queue.filter((_, i) => i !== index), current.queue[current.currentIndex]?.id))
  }, [replaceSelection])

  const seek = useCallback((time: number, remote = false) => {
    if (!Number.isFinite(time) || !audioRef.current?.hasBuffers) return
    remotePlaybackRef.current = remote
    audioRef.current.seek(time)
    if (!remote) syncCommandRef.current?.('seek', { time: audioRef.current.currentTime })
  }, [])

  const step = useCallback((direction: 1 | -1, remote = false) => {
    const state = selectionRef.current
    const index = adjacentReadyIndex(state.queue, state.currentIndex, direction)
    if (index >= 0) void playIndex(index, remote)
  }, [playIndex])
  const prev = useCallback(() => step(-1), [step])
  const next = useCallback(() => step(1), [step])

  const updateSettings = useCallback((next: Partial<typeof settings>) => {
    settingsRef.current = { ...settingsRef.current, ...next }
    setSettings(settingsRef.current)
    audioRef.current?.setSettings(settingsRef.current)
  }, [])
  const setVocalsVolume = useCallback((volume: number) => updateSettings({ vocalsVolume: normalizeVolume(volume) }), [updateSettings])
  const setInstrumentalVolume = useCallback((volume: number) => updateSettings({ instrumentalVolume: normalizeVolume(volume) }), [updateSettings])
  const toggleKaraokeMode = useCallback(() => {
    const karaokeMode = !settingsRef.current.karaokeMode
    updateSettings({ karaokeMode })
    showToast(karaokeMode ? 'Karaoke mode: vocals muted' : 'Vocals restored', 'success')
  }, [updateSettings])

  const toggleFavorite = useCallback(async (trackId: string) => {
    if (!isValidTrackId(trackId)) return
    const id = normalizeTrackId(trackId)
    if (favoritePendingRef.current.has(id)) return
    favoritePendingRef.current.add(id)
    const wasFavorite = favoritesRef.current.has(id)
    try {
      await (wasFavorite ? tracks.removeFavorite(id) : tracks.addFavorite(id))
      if (!mountedRef.current) return
      const next = new Set(favoritesRef.current)
      if (wasFavorite) next.delete(id)
      else next.add(id)
      favoritesRef.current = next
      setFavorites(next)
    } catch { if (mountedRef.current) showToast('Failed to update favorite', 'error') }
    finally { favoritePendingRef.current.delete(id) }
  }, [])

  const editWord = useCallback(async (segIdx: number, wordIdx: number, newWord: string) => {
    const state = selectionRef.current
    const track = state.queue[state.currentIndex]
    if (!track) return
    const version = lyricsVersionRef.current
    try {
      await tracks.editWord(track.id, { segmentIndex: segIdx, wordIndex: wordIdx, word: newWord })
      if (!mountedRef.current || version !== lyricsVersionRef.current) return
      setLyrics(previous => {
        if (!previous?.segments[segIdx]?.words[wordIdx]) return previous
        return { ...previous, segments: previous.segments.map((segment, i) => i === segIdx ? { ...segment, words: segment.words.map((word, j) => j === wordIdx ? { ...word, word: newWord } : word) } : segment) }
      })
      showToast('Word updated', 'success')
    } catch { if (mountedRef.current) showToast('Failed to update word', 'error') }
  }, [])

  const shuffle = useCallback(() => {
    const current = selectionRef.current
    const shuffled = [...current.queue]
    if (shuffled.length < 2) return
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    replaceSelection(selectById(shuffled, current.queue[current.currentIndex]?.id))
    showToast('Queue shuffled', 'success')
  }, [replaceSelection])

  const clearQueue = useCallback(() => {
    const state = selectionRef.current
    const current = state.queue[state.currentIndex]
    pendingAutoplayRef.current = null
    replaceSelection({ queue: current ? [current] : [], currentIndex: current ? 0 : -1 })
    showToast('Queue cleared', 'success')
  }, [replaceSelection])

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    const current = selectionRef.current
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || !current.queue[fromIndex] || !current.queue[toIndex] || fromIndex === toIndex) return
    const nextQueue = [...current.queue]
    const [moved] = nextQueue.splice(fromIndex, 1)
    nextQueue.splice(toIndex, 0, moved)
    replaceSelection(selectById(nextQueue, current.queue[current.currentIndex]?.id))
  }, [replaceSelection])

  const retryTrack = useCallback(async (index: number) => {
    const item = selectionRef.current.queue[index]
    if (!item?.error || trackRequestsRef.current.has(item.id)) return
    const updated = { ...item, ready: false, error: false, progress: 0, status: 'processing' }
    if (updateItem(item, updated)) await requestTrack(updated)
  }, [requestTrack, updateItem])

  const applySyncState = useCallback((state: SyncState) => {
    if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
    const old = selectionRef.current
    const previousId = old.queue[old.currentIndex]?.id
    const restored = restoreQueue(state.queue, state.currentIndex)
    const newItem = restored.queue[restored.currentIndex]
    pendingAutoplayRef.current = null
    remotePlaybackRef.current = true
    replaceSelection(restored, true)
    if (newItem?.id !== previousId) {
      ++playbackVersionRef.current
      audioRef.current?.stop()
      clearLyrics()
      if (newItem) {
        if (state.isPlaying) void playIndex(restored.currentIndex, true)
        else void loadLyrics(newItem.id)
      }
    } else if (state.isPlaying && newItem) {
      if (!audioRef.current?.isPlaying && !audioRef.current?.isLoading) void resume(true)
    } else {
      pause(true)
      // Restored storage and the saved server queue may select the same song.
      // Its identity alone does not mean this mount has loaded its lyrics.
      if (newItem && lyricsTrackRef.current !== newItem.id) void loadLyrics(newItem.id)
    }
  }, [replaceSelection, playIndex, resume, pause, clearLyrics, loadLyrics])

  const applySyncCommand = useCallback((command: SyncCommand) => {
    if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
    switch (command.command) {
      case 'play': if (!audioRef.current?.isPlaying && !audioRef.current?.isLoading) void resume(true); break
      case 'pause': pause(true); break
      case 'next': step(1, true); break
      case 'prev': step(-1, true); break
      case 'seek': if (typeof command.payload?.time === 'number') seek(command.payload.time, true); break
      case 'playIndex': {
        const index = command.payload?.index
        if (typeof index !== 'number' || !Number.isInteger(index)) break
        const id = queueSnapshot(selectionRef.current.queue, selectionRef.current.currentIndex).items[index]?.id
        const localIndex = selectionRef.current.queue.findIndex(item => item.id === id)
        if (localIndex >= 0) void playIndex(localIndex, true)
        break
      }
    }
  }, [resume, pause, step, seek, playIndex])

  return {
    queue, currentIndex, currentTrack: queue[currentIndex] ?? null, ...playback, lyrics, lyricsLoading,
    karaokeMode: settings.karaokeMode, favorites, analyserRef,
    initialVocalsVolume: settings.vocalsVolume, initialInstrumentalVolume: settings.instrumentalVolume,
    addToQueue, playIndex, togglePlay, seek, prev, next, removeFromQueue,
    setVocalsVolume, setInstrumentalVolume, toggleKaraokeMode, toggleFavorite, editWord,
    shuffle, clearQueue, reorderQueue, retryTrack,
    syncPushRef, syncCommandRef, syncPlaybackIntentRef, applySyncState, applySyncCommand,
  }
}
