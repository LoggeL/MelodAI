import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { tracks } from '../../services/api'
import type { LibraryTrack, Playlist, ProcessingStatus } from '../../types'

export function useLibraryData(enabled: boolean, playlistId: number | null) {
  const [songs, setSongs] = useState<LibraryTrack[]>([])
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const { setCredits: updateSharedCredits } = useAuth()
  const [credits, setLocalCredits] = useState<number | null>(null)
  const setCredits = useCallback((balance: number | null) => {
    setLocalCredits(balance)
    if (balance !== null) updateSharedCredits(balance)
  }, [updateSharedCredits])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [statuses, setStatuses] = useState<Record<string, ProcessingStatus>>({})
  const [playlistState, setPlaylistState] = useState<{ id: number | null; songs: LibraryTrack[]; error: string; loading: boolean }>({ id: null, songs: [], error: '', loading: false })
  const loadSeq = useRef(0)
  const playlistSeq = useRef(0)
  const activePlaylistId = useRef(playlistId)
  activePlaylistId.current = playlistId

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError('')
    try {
      const [library, favoriteIds, lists, balance] = await Promise.all([
        tracks.library(), tracks.favorites(), tracks.playlists(), tracks.credits(),
      ])
      if (seq !== loadSeq.current) return
      setSongs(library)
      setFavorites(new Set(favoriteIds))
      setPlaylists(lists)
      setCredits(balance.credits)
      setLoaded(true)
    } catch (err) {
      if (seq === loadSeq.current) setError(err instanceof Error ? err.message : 'Could not load the library.')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [setCredits])

  const refreshPlaylists = useCallback(async () => {
    setPlaylists(await tracks.playlists())
  }, [])

  const loadPlaylist = useCallback(async (id: number) => {
    if (activePlaylistId.current !== id) return
    const seq = ++playlistSeq.current
    setPlaylistState(prev => ({ id, songs: prev.id === id ? prev.songs : [], error: '', loading: true }))
    try {
      const data = await tracks.playlistTracks(id)
      if (seq === playlistSeq.current) setPlaylistState({ id, songs: data, error: '', loading: false })
    } catch (err) {
      if (seq === playlistSeq.current) setPlaylistState({ id, songs: [], error: err instanceof Error ? err.message : 'Could not load this playlist.', loading: false })
    }
  }, [])

  useEffect(() => {
    if (enabled) void load()
    return () => { loadSeq.current += 1 }
  }, [enabled, load])

  useEffect(() => {
    if (playlistId !== null) void loadPlaylist(playlistId)
    return () => { playlistSeq.current += 1 }
  }, [playlistId, loadPlaylist])

  useEffect(() => {
    if (!enabled || !songs.some(song => !song.complete)) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 3000
    const poll = async () => {
      try {
        const data = await tracks.status() as Record<string, ProcessingStatus>
        if (cancelled) return
        setStatuses(data)
        delay = 3000
        if (songs.some(song => !song.complete && data[song.id]?.status === 'complete')) {
          const [library, balance] = await Promise.all([tracks.library(), tracks.credits()])
          if (cancelled) return
          setSongs(library)
          setCredits(balance.credits)
          if (playlistId !== null) void loadPlaylist(playlistId)
        }
      } catch {
        delay = Math.min(delay * 2, 30000)
      }
      if (!cancelled) timer = setTimeout(() => void poll(), delay)
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [enabled, songs, playlistId, loadPlaylist, setCredits])

  return {
    songs, setSongs, favorites, setFavorites, playlists, setPlaylists, credits, setCredits,
    loading, loaded, error, load, statuses, setStatuses, refreshPlaylists, loadPlaylist,
    playlistTracks: playlistState.id === playlistId ? playlistState.songs : [],
    playlistLoading: playlistId !== null && (playlistState.id !== playlistId || playlistState.loading),
    playlistError: playlistState.id === playlistId ? playlistState.error : '',
  }
}
