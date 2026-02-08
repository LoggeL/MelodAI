import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faRotateRight, faRecordVinyl,
  faHeart as faHeartSolid, faMagnifyingGlass, faPlay, faPlus, faPause, faMicrophone,
  faTableCells, faList, faVolumeLow, faTrash, faXmark, faMusic, faEllipsisVertical,
  faCoins, faGlobe, faListUl, faChevronLeft,
} from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../hooks/useAuth'
import { tracks } from '../services/api'
import { useToast } from '../hooks/useToast'
import { HeartButton } from '../components/HeartButton/HeartButton'
import type { LibraryTrack, Playlist, SearchResult, ProcessingStatus } from '../types'
import styles from './LibraryPage.module.css'

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toString().padStart(2, '0')
  return `${mins}:${secs}`
}

/** Upgrade Deezer cover URL to 500x500 for grid view. */
function hiResCover(url: string): string {
  return url.replace(/\/\d+x\d+/, '/500x500')
}

type LibraryTab = 'all' | 'favorites' | 'playlists'

export function LibraryPage() {
  const navigate = useNavigate()
  const { checked, authenticated } = useAuth()
  const toast = useToast()

  const [songs, setSongs] = useState<LibraryTrack[]>([])
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState('')
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewProgress, setPreviewProgress] = useState(0)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [previewVolume, setPreviewVolume] = useState(80)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const animRef = useRef<number | null>(null)

  // Tab & playlist state
  const [activeTab, setActiveTab] = useState<LibraryTab>('all')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [viewingPlaylistId, setViewingPlaylistId] = useState<number | null>(null)
  const [playlistTracks, setPlaylistTracks] = useState<LibraryTrack[]>([])
  const [addingSongsToPlaylist, setAddingSongsToPlaylist] = useState(false)
  const [addSongsFilter, setAddSongsFilter] = useState('')
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const newPlaylistRef = useRef<HTMLInputElement>(null)

  // Add-to-playlist dropdown state
  const [addToPlaylistSongId, setAddToPlaylistSongId] = useState<string | null>(null)
  const addToPlaylistRef = useRef<HTMLDivElement>(null)
  const [dropdownNewName, setDropdownNewName] = useState('')

  // Search & Add state
  const [searchMode, setSearchMode] = useState<'filter' | 'add'>('filter')
  const [deezerQuery, setDeezerQuery] = useState('')
  const [deezerResults, setDeezerResults] = useState<SearchResult[]>([])
  const [deezerLoading, setDeezerLoading] = useState(false)
  const [credits, setCredits] = useState<number | null>(null)
  const deezerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchDropdownRef = useRef<HTMLDivElement>(null)

  // Processing status state
  const [processingStatuses, setProcessingStatuses] = useState<Record<string, ProcessingStatus>>({})
  const statusIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Toast ref to avoid dependency cycles
  const toastRef = useRef(toast)
  toastRef.current = toast

  useEffect(() => {
    if (checked && !authenticated) navigate('/login')
  }, [checked, authenticated, navigate])

  // Load library + favorites + playlists + credits
  const load = useCallback(async () => {
    try {
      const [data, favIds, playlistData, creditData] = await Promise.all([
        tracks.library(),
        tracks.favorites(),
        tracks.playlists(),
        tracks.credits(),
      ])
      setSongs(data)
      setFavorites(new Set(favIds))
      setPlaylists(playlistData)
      setCredits(creditData.credits)
      setLoaded(true)
    } catch {
      toastRef.current.error('Failed to load library')
    }
  }, [])

  useEffect(() => {
    if (!loaded && checked && authenticated) load()
  }, [loaded, load, checked, authenticated])

  // Fetch playlist tracks when viewing a playlist
  useEffect(() => {
    if (viewingPlaylistId !== null) {
      tracks.playlistTracks(viewingPlaylistId).then(setPlaylistTracks).catch(() => {
        toast.error('Failed to load playlist')
        setPlaylistTracks([])
      })
    }
  }, [viewingPlaylistId, toast])

  // Determine the base song list
  const baseSongs = useMemo(() => {
    if (viewingPlaylistId !== null) return playlistTracks
    if (activeTab === 'favorites') return songs.filter(s => favorites.has(s.id))
    return songs
  }, [songs, viewingPlaylistId, playlistTracks, activeTab, favorites])

  const filtered = useMemo(() => {
    let list = baseSongs
    if (filter) {
      const q = filter.toLowerCase()
      list = list.filter(s =>
        s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
      )
    }
    // Sort: errored first, then processing, then complete; alphabetical within each group
    return [...list].sort((a, b) => {
      const aError = !a.complete && processingStatuses[a.id]?.status === 'error'
      const bError = !b.complete && processingStatuses[b.id]?.status === 'error'
      const aProcessing = !a.complete && !aError
      const bProcessing = !b.complete && !bError
      const aRank = aError ? 0 : aProcessing ? 1 : 2
      const bRank = bError ? 0 : bProcessing ? 1 : 2
      if (aRank !== bRank) return aRank - bRank
      return a.title.localeCompare(b.title)
    })
  }, [baseSongs, filter, processingStatuses])

  // Songs available to add to current playlist (not already in it)
  const addableSongs = useMemo(() => {
    if (viewingPlaylistId === null) return []
    const playlistIds = new Set(playlistTracks.map(t => t.id))
    let available = songs.filter(s => s.complete && !playlistIds.has(s.id))
    if (addSongsFilter) {
      const q = addSongsFilter.toLowerCase()
      available = available.filter(s =>
        s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
      )
    }
    return available
  }, [songs, playlistTracks, viewingPlaylistId, addSongsFilter])

  // Poll processing statuses for incomplete tracks with exponential backoff
  useEffect(() => {
    let cancelled = false
    let delay = 3000
    const BASE_DELAY = 3000
    const MAX_DELAY = 30000

    const pollStatuses = async () => {
      if (cancelled) return
      const incomplete = songs.filter(s => !s.complete)
      if (incomplete.length === 0) {
        setProcessingStatuses({})
        return
      }

      try {
        const allStatuses = await tracks.status() as Record<string, ProcessingStatus>
        setProcessingStatuses(allStatuses)
        delay = BASE_DELAY // Reset on success

        // Check if any previously incomplete track is now done
        const completedIds = incomplete.filter(s => {
          const st = allStatuses[s.id]
          return st && st.status === 'complete'
        }).map(s => s.id)

        if (completedIds.length > 0) {
          const [data, creditData] = await Promise.all([
            tracks.library(),
            tracks.credits(),
          ])
          setSongs(data)
          setCredits(creditData.credits)
        }
      } catch {
        // Backoff on failure, cap at MAX_DELAY
        delay = Math.min(delay * 2, MAX_DELAY)
      }

      if (!cancelled) {
        statusIntervalRef.current = setTimeout(pollStatuses, delay)
      }
    }

    pollStatuses()
    return () => {
      cancelled = true
      if (statusIntervalRef.current) clearTimeout(statusIntervalRef.current)
    }
  }, [songs])

  // Deezer search with debounce
  useEffect(() => {
    if (searchMode !== 'add' || !deezerQuery.trim()) {
      setDeezerResults([])
      return
    }
    if (deezerTimerRef.current) clearTimeout(deezerTimerRef.current)
    deezerTimerRef.current = setTimeout(async () => {
      setDeezerLoading(true)
      try {
        const results = await tracks.search(deezerQuery)
        setDeezerResults(results)
      } catch {
        toast.error('Search failed')
        setDeezerResults([])
      } finally {
        setDeezerLoading(false)
      }
    }, 400)
    return () => {
      if (deezerTimerRef.current) clearTimeout(deezerTimerRef.current)
    }
  }, [deezerQuery, searchMode, toast])

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (addToPlaylistRef.current && !addToPlaylistRef.current.contains(e.target as Node)) {
        setAddToPlaylistSongId(null)
      }
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        // Don't close if clicking inside the search input
        const searchInput = document.querySelector(`.${styles.searchInput}`)
        if (searchInput && searchInput.contains(e.target as Node)) return
        setDeezerResults([])
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Focus new playlist input
  useEffect(() => {
    if (creatingPlaylist && newPlaylistRef.current) {
      newPlaylistRef.current.focus()
    }
  }, [creatingPlaylist])

  const toggleFavorite = useCallback(async (id: string) => {
    const isFav = favorites.has(id)
    try {
      if (isFav) {
        await tracks.removeFavorite(id)
        setFavorites(prev => { const n = new Set(prev); n.delete(id); return n })
      } else {
        await tracks.addFavorite(id)
        setFavorites(prev => new Set(prev).add(id))
      }
    } catch {
      toast.error('Failed to update favorite')
    }
  }, [favorites, toast])

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
    if (animRef.current) cancelAnimationFrame(animRef.current)
    setPreviewId(null)
    setPreviewProgress(0)
  }, [])

  const togglePreview = useCallback((id: string) => {
    if (previewId === id) {
      stopPreview()
      return
    }
    stopPreview()

    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener('ended', () => {
        setPreviewId(null)
        setPreviewProgress(0)
      })
    }

    audioRef.current.src = `/songs/${id}/song.mp3`
    audioRef.current.currentTime = 30
    audioRef.current.volume = previewVolume / 100
    audioRef.current.play().catch(() => {})
    setPreviewId(id)

    const tick = () => {
      if (audioRef.current && previewId !== null) {
        const start = 30
        const dur = audioRef.current.duration || 0
        const cur = audioRef.current.currentTime
        const elapsed = cur - start
        const maxLen = Math.min(30, dur - start)
        setPreviewProgress(maxLen > 0 ? Math.min((elapsed / maxLen) * 100, 100) : 0)

        if (elapsed >= 30) {
          audioRef.current.pause()
          setPreviewId(null)
          setPreviewProgress(0)
          return
        }
      }
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
  }, [previewId, stopPreview, previewVolume])

  // Update volume when slider changes while previewing
  useEffect(() => {
    if (audioRef.current && previewId !== null) {
      audioRef.current.volume = previewVolume / 100
    }
  }, [previewVolume, previewId])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = '' }
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [])

  const handlePlay = useCallback((song: LibraryTrack) => {
    stopPreview()
    navigate(`/song/${song.id}`)
  }, [navigate, stopPreview])

  // Tab switching
  const handleSelectTab = useCallback((tab: LibraryTab) => {
    setActiveTab(tab)
    setViewingPlaylistId(null)
    setAddingSongsToPlaylist(false)
    setAddSongsFilter('')
    setFilter('')
  }, [])

  // Playlist handlers
  const handleCreatePlaylist = useCallback(async () => {
    const name = newPlaylistName.trim()
    if (!name) return
    try {
      const result = await tracks.createPlaylist(name)
      setPlaylists(prev => [...prev, { id: result.id, name: result.name, track_count: 0, created_at: new Date().toISOString() }])
      setNewPlaylistName('')
      setCreatingPlaylist(false)
      toast.success(`Created "${name}"`)
    } catch {
      toast.error('Failed to create playlist')
    }
  }, [newPlaylistName, toast])

  const handleDeletePlaylist = useCallback(async (id: number, name: string) => {
    try {
      await tracks.deletePlaylist(id)
      setPlaylists(prev => prev.filter(p => p.id !== id))
      if (viewingPlaylistId === id) {
        setViewingPlaylistId(null)
        setPlaylistTracks([])
        setAddingSongsToPlaylist(false)
      }
      toast.success(`Deleted "${name}"`)
    } catch {
      toast.error('Failed to delete playlist')
    }
  }, [viewingPlaylistId, toast])

  const handleAddToPlaylist = useCallback(async (playlistId: number, songId: string) => {
    try {
      await tracks.addToPlaylist(playlistId, songId)
      setPlaylists(prev => prev.map(p => p.id === playlistId ? { ...p, track_count: p.track_count + 1 } : p))
      // Refresh playlist tracks if viewing this playlist
      if (viewingPlaylistId === playlistId) {
        const updated = await tracks.playlistTracks(playlistId)
        setPlaylistTracks(updated)
      }
      toast.success('Added to playlist')
    } catch {
      toast.error('Failed to add to playlist')
    }
    setAddToPlaylistSongId(null)
  }, [viewingPlaylistId, toast])

  const handleRemoveFromPlaylist = useCallback(async (songId: string) => {
    if (viewingPlaylistId === null) return
    try {
      await tracks.removeFromPlaylist(viewingPlaylistId, songId)
      setPlaylistTracks(prev => prev.filter(t => t.id !== songId))
      setPlaylists(prev => prev.map(p => p.id === viewingPlaylistId ? { ...p, track_count: Math.max(0, p.track_count - 1) } : p))
      toast.success('Removed from playlist')
    } catch {
      toast.error('Failed to remove from playlist')
    }
  }, [viewingPlaylistId, toast])

  const handleReprocess = useCallback(async (songId: string) => {
    try {
      await tracks.add(songId)
      toast.success('Reprocessing...')
    } catch {
      toast.error('Failed to reprocess')
    }
  }, [toast])

  const handleCreateAndAdd = useCallback(async (songId: string) => {
    const name = dropdownNewName.trim()
    if (!name) return
    try {
      const result = await tracks.createPlaylist(name)
      setPlaylists(prev => [...prev, { id: result.id, name: result.name, track_count: 1, created_at: new Date().toISOString() }])
      await tracks.addToPlaylist(result.id, songId)
      setDropdownNewName('')
      setAddToPlaylistSongId(null)
      toast.success(`Created "${name}" and added song`)
    } catch {
      toast.error('Failed to create playlist')
    }
  }, [dropdownNewName, toast])

  // Add song from Deezer search
  const handleAddSong = useCallback(async (result: SearchResult) => {
    try {
      const resp = await tracks.add(result.id)
      if (resp.status === 'error') {
        toast.error('Failed to add song')
        return
      }
      // Add to library list immediately as incomplete
      const newTrack: LibraryTrack = {
        id: result.id,
        title: result.title,
        artist: result.artist,
        album: result.album,
        duration: 0,
        img_url: result.img_url,
        complete: false,
      }
      setSongs(prev => {
        if (prev.some(s => s.id === result.id)) return prev
        return [newTrack, ...prev]
      })
      // Refresh credits
      tracks.credits().then(c => setCredits(c.credits)).catch(() => {})
      toast.success(`Processing "${result.title}"`)
      setDeezerQuery('')
      setDeezerResults([])
    } catch {
      toast.error('Failed to add song')
    }
  }, [toast])

  // Open a playlist detail view
  const handleOpenPlaylist = useCallback((id: number) => {
    setViewingPlaylistId(id)
    setAddingSongsToPlaylist(false)
    setAddSongsFilter('')
    setFilter('')
  }, [])

  // Go back from playlist detail to overview
  const handleBackToPlaylists = useCallback(() => {
    setViewingPlaylistId(null)
    setPlaylistTracks([])
    setAddingSongsToPlaylist(false)
    setAddSongsFilter('')
    setFilter('')
  }, [])

  if (!checked || !authenticated) return null

  const readyCount = songs.filter(s => s.complete).length
  const favCount = songs.filter(s => favorites.has(s.id)).length
  const processingCount = songs.filter(s => !s.complete).length
  const viewingPlaylist = playlists.find(p => p.id === viewingPlaylistId)

  // Whether to show the toolbar and song grid/list
  const showSongViews = activeTab !== 'playlists' || viewingPlaylistId !== null
  const isPlaylistDetail = viewingPlaylistId !== null

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <Link to="/" className={styles.backBtn}>
            <FontAwesomeIcon icon={faArrowLeft} />
          </Link>
          <div className={styles.headerInfo}>
            <h1 className={styles.title}>Library</h1>
            <p className={styles.subtitle}>
              {readyCount} song{readyCount !== 1 ? 's' : ''} ready
              {processingCount > 0 && <> &middot; {processingCount} processing</>}
              {favCount > 0 && <> &middot; {favCount} favorite{favCount !== 1 ? 's' : ''}</>}
            </p>
          </div>
          {credits !== null && (
            <div className={styles.creditsBadge}>
              <FontAwesomeIcon icon={faCoins} />
              <span>{credits}</span>
            </div>
          )}
          <button className={styles.refreshBtn} onClick={load} title="Refresh">
            <FontAwesomeIcon icon={faRotateRight} />
          </button>
        </div>

        {/* Tab Pills */}
        <div className={styles.pillRow}>
          <button
            className={`${styles.pill} ${activeTab === 'all' && !isPlaylistDetail ? styles.pillActive : ''}`}
            onClick={() => handleSelectTab('all')}
          >
            <FontAwesomeIcon icon={faMusic} />
            All Songs
          </button>
          <button
            className={`${styles.pill} ${activeTab === 'favorites' ? styles.pillActive : ''}`}
            onClick={() => handleSelectTab('favorites')}
          >
            <FontAwesomeIcon icon={faHeartSolid} />
            Favorites
            {favCount > 0 && <span className={styles.pillCount}>{favCount}</span>}
          </button>
          <button
            className={`${styles.pill} ${activeTab === 'playlists' ? styles.pillActive : ''}`}
            onClick={() => handleSelectTab('playlists')}
          >
            <FontAwesomeIcon icon={faListUl} />
            Playlists
            {playlists.length > 0 && <span className={styles.pillCount}>{playlists.length}</span>}
          </button>
        </div>

        {/* Playlist Detail Header */}
        {isPlaylistDetail && viewingPlaylist && (
          <div className={styles.playlistDetailHeader}>
            <button className={styles.playlistBackBtn} onClick={handleBackToPlaylists}>
              <FontAwesomeIcon icon={faChevronLeft} />
              Playlists
            </button>
            <div className={styles.playlistDetailInfo}>
              <h2 className={styles.playlistDetailName}>{viewingPlaylist.name}</h2>
              <span className={styles.playlistDetailCount}>
                {playlistTracks.length} track{playlistTracks.length !== 1 ? 's' : ''}
              </span>
            </div>
            <button
              className={`${styles.playlistAddSongsBtn} ${addingSongsToPlaylist ? styles.playlistAddSongsBtnActive : ''}`}
              onClick={() => { setAddingSongsToPlaylist(prev => !prev); setAddSongsFilter('') }}
            >
              <FontAwesomeIcon icon={addingSongsToPlaylist ? faXmark : faPlus} />
              {addingSongsToPlaylist ? 'Done' : 'Add Songs'}
            </button>
            <button
              className={styles.playlistDeleteBtn}
              onClick={() => handleDeletePlaylist(viewingPlaylist.id, viewingPlaylist.name)}
              title="Delete playlist"
            >
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </div>
        )}

        {/* Add Songs Panel (playlist detail mode) */}
        {isPlaylistDetail && addingSongsToPlaylist && (
          <div className={styles.addSongsSection}>
            <div className={styles.addSongsSearchWrap}>
              <FontAwesomeIcon icon={faMagnifyingGlass} className={styles.searchIcon} />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Filter songs to add..."
                value={addSongsFilter}
                onChange={e => setAddSongsFilter(e.target.value)}
              />
            </div>
            <div className={styles.addSongsList}>
              {addableSongs.length === 0 ? (
                <div className={styles.addSongsEmpty}>
                  {addSongsFilter ? 'No matching songs' : 'All library songs are already in this playlist'}
                </div>
              ) : (
                addableSongs.map(song => (
                  <div key={song.id} className={styles.addSongRow}>
                    <img
                      src={song.img_url || '/logo.svg'}
                      alt=""
                      className={styles.addSongThumb}
                      loading="lazy"
                    />
                    <div className={styles.addSongInfo}>
                      <div className={styles.addSongTitle}>{song.title}</div>
                      <div className={styles.addSongArtist}>{song.artist}</div>
                    </div>
                    <button
                      className={styles.addSongBtn}
                      onClick={() => handleAddToPlaylist(viewingPlaylistId!, song.id)}
                    >
                      <FontAwesomeIcon icon={faPlus} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Playlists Overview */}
        {activeTab === 'playlists' && viewingPlaylistId === null && (
          <div className={styles.playlistsOverview}>
            <div className={styles.playlistsGrid}>
              {playlists.map(pl => (
                <div
                  key={pl.id}
                  className={styles.playlistCard}
                  onClick={() => handleOpenPlaylist(pl.id)}
                >
                  <div className={styles.playlistCardMosaic}>
                    <FontAwesomeIcon icon={faListUl} />
                  </div>
                  <div className={styles.playlistCardBody}>
                    <div className={styles.playlistCardName}>{pl.name}</div>
                    <div className={styles.playlistCardCount}>
                      {pl.track_count} track{pl.track_count !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <button
                    className={styles.playlistCardDelete}
                    onClick={e => { e.stopPropagation(); handleDeletePlaylist(pl.id, pl.name) }}
                    title="Delete playlist"
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              ))}

              {/* Create new playlist card */}
              {creatingPlaylist ? (
                <div className={styles.playlistCreateCard}>
                  <div className={styles.playlistCardMosaic}>
                    <FontAwesomeIcon icon={faPlus} />
                  </div>
                  <div className={styles.playlistCardBody}>
                    <input
                      ref={newPlaylistRef}
                      className={styles.playlistCreateInput}
                      type="text"
                      placeholder="Playlist name..."
                      value={newPlaylistName}
                      onChange={e => setNewPlaylistName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCreatePlaylist()
                        if (e.key === 'Escape') { setCreatingPlaylist(false); setNewPlaylistName('') }
                      }}
                      onBlur={() => {
                        if (!newPlaylistName.trim()) { setCreatingPlaylist(false); setNewPlaylistName('') }
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div
                  className={styles.playlistNewCard}
                  onClick={() => setCreatingPlaylist(true)}
                >
                  <div className={styles.playlistNewCardIcon}>
                    <FontAwesomeIcon icon={faPlus} />
                  </div>
                  <span className={styles.playlistNewCardLabel}>New Playlist</span>
                </div>
              )}
            </div>

            {/* Empty state for no playlists */}
            {playlists.length === 0 && !creatingPlaylist && (
              <div className={styles.emptyState}>
                <FontAwesomeIcon icon={faListUl} className={styles.emptyIcon} />
                <h3>No playlists yet</h3>
                <p>Create a playlist to organize your songs</p>
              </div>
            )}
          </div>
        )}

        {/* Toolbar - visible for all/favorites/playlist detail (not overview) */}
        {showSongViews && !addingSongsToPlaylist && (
          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <FontAwesomeIcon icon={searchMode === 'add' ? faGlobe : faMagnifyingGlass} className={styles.searchIcon} />
              {searchMode === 'filter' ? (
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Filter library..."
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                />
              ) : (
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Search Deezer to add songs..."
                  value={deezerQuery}
                  onChange={e => setDeezerQuery(e.target.value)}
                />
              )}
            </div>

            {/* Search mode toggle */}
            <button
              className={`${styles.modeToggle} ${searchMode === 'add' ? styles.modeToggleActive : ''}`}
              onClick={() => {
                setSearchMode(prev => prev === 'filter' ? 'add' : 'filter')
                setFilter('')
                setDeezerQuery('')
                setDeezerResults([])
              }}
              title={searchMode === 'filter' ? 'Switch to Add New Song' : 'Switch to Filter Library'}
            >
              <FontAwesomeIcon icon={searchMode === 'filter' ? faGlobe : faMagnifyingGlass} />
            </button>

            {/* Preview volume slider */}
            <div className={`${styles.volumeWrap} ${previewId !== null ? styles.volumeWrapVisible : ''}`}>
              <FontAwesomeIcon icon={faVolumeLow} className={styles.volumeIcon} />
              <input
                type="range"
                min={0}
                max={100}
                value={previewVolume}
                onChange={e => setPreviewVolume(Number(e.target.value))}
                className={styles.volumeSlider}
                title={`Preview volume: ${previewVolume}%`}
              />
            </div>

            {/* View mode toggle */}
            <div className={styles.viewToggle}>
              <button
                className={`${styles.viewToggleBtn} ${viewMode === 'grid' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setViewMode('grid')}
                title="Grid view"
              >
                <FontAwesomeIcon icon={faTableCells} />
              </button>
              <button
                className={`${styles.viewToggleBtn} ${viewMode === 'list' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setViewMode('list')}
                title="List view"
              >
                <FontAwesomeIcon icon={faList} />
              </button>
            </div>
          </div>
        )}

        {/* Deezer search results as cards */}
        {showSongViews && searchMode === 'add' && (deezerResults.length > 0 || deezerLoading) && (
          <>
            {deezerLoading && deezerResults.length === 0 && (
              <div className={styles.searchResultsLoading}>Searching Deezer...</div>
            )}
            {deezerResults.length > 0 && (
              <>
                <div className={styles.searchResultsHeader}>
                  <span>Search Results</span>
                  <span className={styles.searchResultsCount}>{deezerResults.length} found</span>
                </div>
                <div className={styles.grid}>
                  {deezerResults.map(result => {
                    const alreadyInLibrary = songs.some(s => s.id === result.id)
                    return (
                      <div key={result.id} className={styles.card}>
                        <div className={styles.cardArt}>
                          <img src={hiResCover(result.img_url)} alt="" loading="lazy" />
                          {alreadyInLibrary && (
                            <div className={styles.inLibraryOverlay}>
                              <FontAwesomeIcon icon={faMusic} />
                              <span>In Library</span>
                            </div>
                          )}
                        </div>
                        <div className={styles.cardBody}>
                          <div className={styles.cardTitle}>{result.title}</div>
                          <div className={styles.cardArtist}>{result.artist}</div>
                        </div>
                        <div className={styles.cardActions}>
                          {alreadyInLibrary ? (
                            <span className={styles.inLibraryBadge}>Already Added</span>
                          ) : (
                            <button
                              className={styles.deezerAddBtn}
                              onClick={() => handleAddSong(result)}
                            >
                              <FontAwesomeIcon icon={faPlus} />
                              Add to Library
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* Empty state */}
        {showSongViews && !addingSongsToPlaylist && filtered.length === 0 && loaded && searchMode !== 'add' && (
          <div className={styles.emptyState}>
            <FontAwesomeIcon icon={faRecordVinyl} className={styles.emptyIcon} />
            <h3>
              {activeTab === 'favorites' ? 'No favorites yet'
                : isPlaylistDetail ? 'Playlist is empty'
                : filter ? 'No matches'
                : 'Library is empty'}
            </h3>
            <p>
              {activeTab === 'favorites' ? 'Heart some songs to see them here'
                : isPlaylistDetail ? 'Use "Add Songs" to add tracks to this playlist'
                : filter ? 'Try a different search'
                : 'Switch to "Add New Song" mode to search and process tracks'}
            </p>
          </div>
        )}

        {/* Grid View */}
        {showSongViews && !addingSongsToPlaylist && viewMode === 'grid' && (
          <div className={styles.grid}>
            {filtered.map(song => {
              const isFav = favorites.has(song.id)
              const isPreviewing = previewId === song.id
              const status = processingStatuses[song.id]
              const isProcessing = !song.complete
              return (
                <div key={song.id} className={`${styles.card} ${isPreviewing ? styles.cardPreviewing : ''} ${isProcessing ? styles.cardProcessing : ''}`}>
                  <div className={styles.cardArt}>
                    <img src={song.img_url ? hiResCover(song.img_url) : '/logo.svg'} alt="" loading="lazy" />
                    {song.complete && (
                      <HeartButton
                        active={isFav}
                        onClick={() => toggleFavorite(song.id)}
                        className={styles.artFavBtn}
                        activeClassName={styles.artFavBtnActive}
                        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                      />
                    )}
                    {isFav && <div className={styles.favBadge} />}

                    {/* Processing overlay */}
                    {isProcessing && (
                      <div className={styles.processingOverlay}>
                        {status?.status === 'error' ? (
                          <>
                            <div className={styles.processingProgress} style={{ fontSize: '1rem' }}>Error</div>
                            <button className={styles.reprocessBtn} onClick={() => handleReprocess(song.id)}>
                              <FontAwesomeIcon icon={faRotateRight} /> Retry
                            </button>
                          </>
                        ) : (
                          <>
                            <div className={styles.processingProgress}>
                              {status ? `${Math.round(status.progress)}%` : '0%'}
                            </div>
                            <div className={styles.processingDetail}>
                              {status?.detail || status?.status || 'Queued'}
                            </div>
                            <div className={styles.processingBar}>
                              <div
                                className={styles.processingBarFill}
                                style={{ width: `${status?.progress ?? 0}%` }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {isPreviewing && (
                      <div className={styles.previewBar}>
                        <div className={styles.previewFill} style={{ width: `${previewProgress}%` }} />
                      </div>
                    )}
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardTitle}>{song.title}</div>
                    <div className={styles.cardArtist}>{song.artist}</div>
                  </div>
                  {song.complete && (
                    <div className={styles.cardActions}>
                      <button
                        className={`${styles.previewBtn} ${isPreviewing ? styles.previewBtnActive : ''}`}
                        onClick={() => togglePreview(song.id)}
                        title={isPreviewing ? 'Stop preview' : 'Preview'}
                      >
                        <FontAwesomeIcon icon={isPreviewing ? faPause : faPlay} />
                      </button>
                      <button
                        className={styles.playBtn}
                        onClick={() => handlePlay(song)}
                        title="Play in karaoke"
                      >
                        <FontAwesomeIcon icon={faMicrophone} />
                      </button>
                      <div className={styles.cardMenuWrap}>
                        <button
                          className={styles.addQueueBtn}
                          onClick={() => setAddToPlaylistSongId(prev => prev === song.id ? null : song.id)}
                          title="Add to playlist"
                        >
                          <FontAwesomeIcon icon={faEllipsisVertical} />
                        </button>
                        {addToPlaylistSongId === song.id && (
                          <div className={styles.playlistDropdown} ref={addToPlaylistRef}>
                            <div className={styles.playlistDropdownTitle}>Add to playlist</div>
                            {playlists.map(pl => (
                              <button
                                key={pl.id}
                                className={styles.playlistDropdownItem}
                                onClick={() => handleAddToPlaylist(pl.id, song.id)}
                              >
                                {pl.name}
                              </button>
                            ))}
                            {isPlaylistDetail && (
                              <button
                                className={styles.playlistDropdownRemove}
                                onClick={() => handleRemoveFromPlaylist(song.id)}
                              >
                                <FontAwesomeIcon icon={faTrash} />
                                Remove from playlist
                              </button>
                            )}
                            <div className={styles.playlistDropdownCreate}>
                              <input
                                className={styles.playlistDropdownInput}
                                placeholder="New playlist..."
                                value={dropdownNewName}
                                onChange={e => setDropdownNewName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleCreateAndAdd(song.id)
                                  if (e.key === 'Escape') { setDropdownNewName(''); setAddToPlaylistSongId(null) }
                                }}
                                onClick={e => e.stopPropagation()}
                              />
                              {dropdownNewName.trim() && (
                                <button
                                  className={styles.playlistDropdownCreateBtn}
                                  onClick={() => handleCreateAndAdd(song.id)}
                                >
                                  <FontAwesomeIcon icon={faPlus} />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* List View */}
        {showSongViews && !addingSongsToPlaylist && viewMode === 'list' && (
          <div className={styles.listView}>
            <div className={styles.listHeader}>
              <div className={styles.listColArt} />
              <div className={styles.listColTitle}>Title</div>
              <div className={styles.listColAlbum}>Album</div>
              <div className={styles.listColDuration}>Duration</div>
              <div className={styles.listColActions} />
            </div>
            {filtered.map(song => {
              const isFav = favorites.has(song.id)
              const isPreviewing = previewId === song.id
              const status = processingStatuses[song.id]
              const isProcessing = !song.complete
              return (
                <div
                  key={song.id}
                  className={`${styles.listRow} ${isPreviewing ? styles.listRowPreviewing : ''}`}
                >
                  <div className={styles.listColArt}>
                    <div className={styles.listThumbWrap}>
                      <img
                        src={song.img_url || '/logo.svg'}
                        alt=""
                        loading="lazy"
                        className={styles.listThumb}
                      />
                      {isProcessing && (
                        <div className={styles.listThumbOverlay}>
                          <span className={styles.listThumbProgress}>
                            {status ? `${Math.round(status.progress)}%` : '...'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={styles.listColTitle}>
                    <div className={styles.listTitle}>{song.title}</div>
                    <div className={styles.listArtist}>
                      {song.artist}
                      {isProcessing && (
                        <span className={styles.listStatusDetail}>
                          {' '}&middot; {status?.detail || status?.status || 'Queued'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={styles.listColAlbum}>
                    <span className={styles.listAlbumText}>{song.album}</span>
                  </div>
                  <div className={styles.listColDuration}>
                    {song.duration ? formatDuration(song.duration) : '--:--'}
                  </div>
                  <div className={styles.listColActions}>
                    <HeartButton
                      active={isFav}
                      onClick={() => toggleFavorite(song.id)}
                      className={styles.listFavBtn}
                      activeClassName={styles.listFavActive}
                      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    />
                    {song.complete ? (
                      <>
                        <button
                          className={`${styles.listActionBtn} ${isPreviewing ? styles.listActionBtnActive : ''}`}
                          onClick={() => togglePreview(song.id)}
                          title={isPreviewing ? 'Stop preview' : 'Preview'}
                        >
                          <FontAwesomeIcon icon={isPreviewing ? faPause : faPlay} />
                        </button>
                        <button
                          className={`${styles.listActionBtn} ${styles.listPlayBtn}`}
                          onClick={() => handlePlay(song)}
                          title="Play in karaoke"
                        >
                          <FontAwesomeIcon icon={faMicrophone} />
                        </button>
                        <div className={styles.listMenuWrap}>
                          <button
                            className={`${styles.listActionBtn} ${styles.listAddBtn}`}
                            onClick={() => setAddToPlaylistSongId(prev => prev === song.id ? null : song.id)}
                            title="Add to playlist"
                          >
                            <FontAwesomeIcon icon={faEllipsisVertical} />
                          </button>
                          {addToPlaylistSongId === song.id && (
                            <div className={styles.playlistDropdown} ref={addToPlaylistRef}>
                              <div className={styles.playlistDropdownTitle}>Add to playlist</div>
                              {playlists.map(pl => (
                                <button
                                  key={pl.id}
                                  className={styles.playlistDropdownItem}
                                  onClick={() => handleAddToPlaylist(pl.id, song.id)}
                                >
                                  {pl.name}
                                </button>
                              ))}
                              {isPlaylistDetail && (
                                <button
                                  className={styles.playlistDropdownRemove}
                                  onClick={() => handleRemoveFromPlaylist(song.id)}
                                >
                                  <FontAwesomeIcon icon={faTrash} />
                                  Remove from playlist
                                </button>
                              )}
                              <div className={styles.playlistDropdownCreate}>
                                <input
                                  className={styles.playlistDropdownInput}
                                  placeholder="New playlist..."
                                  value={dropdownNewName}
                                  onChange={e => setDropdownNewName(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleCreateAndAdd(song.id)
                                    if (e.key === 'Escape') { setDropdownNewName(''); setAddToPlaylistSongId(null) }
                                  }}
                                  onClick={e => e.stopPropagation()}
                                />
                                {dropdownNewName.trim() && (
                                  <button
                                    className={styles.playlistDropdownCreateBtn}
                                    onClick={() => handleCreateAndAdd(song.id)}
                                  >
                                    <FontAwesomeIcon icon={faPlus} />
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      status?.status === 'error' ? (
                        <button className={styles.listReprocessBtn} onClick={() => handleReprocess(song.id)}>
                          <FontAwesomeIcon icon={faRotateRight} /> Retry
                        </button>
                      ) : (
                        <span className={styles.listProcessing}>
                          {status ? `${Math.round(status.progress)}%` : 'Processing'}
                        </span>
                      )
                    )}
                  </div>
                  {isPreviewing && (
                    <div className={styles.listPreviewBar}>
                      <div className={styles.previewFill} style={{ width: `${previewProgress}%` }} />
                    </div>
                  )}
                  {isProcessing && status && (
                    <div className={styles.listProcessingBar}>
                      <div className={styles.processingBarFill} style={{ width: `${status.progress}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
