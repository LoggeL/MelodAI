import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlayer } from '../hooks/usePlayer'
import { useSync } from '../hooks/useSync'
import type { SyncState, SyncCommand } from '../hooks/useSync'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useAlbumColors } from '../hooks/useAlbumColors'
import { tracks as tracksApi } from '../services/api'
import type { LyricTranslation, TranslationLanguage } from '../types'
import { isValidTrackId, normalizeTrackId } from '../utils/trackId'
import { Sidebar } from '../components/Layout/Sidebar'
import { Header } from '../components/Layout/Header'
import { SearchBar, type SearchBarHandle } from '../components/Search/SearchBar'
import { QueuePanel } from '../components/Queue/QueuePanel'
import { LibraryPanel } from '../components/Library/LibraryPanel'
import { NowPlaying } from '../components/Player/NowPlaying'
import { LyricsView } from '../components/Player/LyricsView'
import { Controls } from '../components/Player/Controls'
import { SuggestedSongs } from '../components/Player/SuggestedSongs'
import styles from './PlayerPage.module.css'

export function PlayerPage() {
  const navigate = useNavigate()
  const { trackId: urlTrackId } = useParams()
  const { checked, authenticated, username, displayName, isAdmin, credits, logout, setCredits } = useAuth()
  const { toggle: toggleTheme } = useTheme()
  const playerOptions = useMemo(() => ({
    isAdmin,
    onCreditsUpdate: setCredits,
  }), [isAdmin, setCredits])
  const player = usePlayer(playerOptions)
  useAlbumColors(player.currentTrack?.thumbnail)
  const searchRef = useRef<SearchBarHandle>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [translationLanguage, setTranslationLanguage] = useState<TranslationLanguage>(() => {
    const stored = localStorage.getItem('melodai_translation_language')
    if (stored === 'de' || stored === 'en') return stored
    const browserLanguage = navigator.language.toLowerCase().split('-')[0]
    return browserLanguage === 'en' ? 'en' : 'de'
  })
  const [translationMode, setTranslationMode] = useState<'original' | 'translation' | 'both'>(() => {
    const stored = localStorage.getItem('melodai_translation_mode')
    return stored === 'translation' || stored === 'both' ? stored : 'original'
  })
  const [translation, setTranslation] = useState<LyricTranslation | null>(null)
  const [translationLoading, setTranslationLoading] = useState(false)

  // Cross-device queue sync
  const onSyncState = useCallback((state: SyncState) => {
    player.applySyncState(state)
  }, [player])

  const onCommand = useCallback((cmd: SyncCommand) => {
    player.applySyncCommand(cmd)
  }, [player])

  const sync = useSync({ enabled: authenticated, onSyncState, onCommand })

  // Wire sync functions into player refs
  useEffect(() => {
    player.syncPushRef.current = () => {
      const readyItems = player.queue.filter(q => q.ready)
      sync.pushQueue(
        readyItems.map(q => ({ id: q.id, title: q.title, artist: q.artist, thumbnail: q.thumbnail })),
        player.currentIndex,
        player.isPlaying,
      )
    }
    player.syncCommandRef.current = (cmd: string, payload?: Record<string, unknown>) => {
      sync.sendCommand(cmd, payload ?? {})
    }
  }, [player, sync])

  useEffect(() => {
    if (checked && !authenticated) {
      const returnTo = urlTrackId ? `/song/${urlTrackId}` : undefined
      navigate('/login', { state: returnTo ? { from: returnTo } : undefined })
    }
  }, [checked, authenticated, navigate, urlTrackId])

  // Load song from URL on mount (route param or legacy hash)
  useEffect(() => {
    async function loadFromUrl(id: string) {
      if (!isValidTrackId(id)) {
        navigate('/', { replace: true })
        return
      }
      const trackId = normalizeTrackId(id)
      try {
        const data = await tracksApi.info(trackId)
        player.addToQueue(trackId, {
          title: data.metadata?.title,
          artist: data.metadata?.artist,
          img_url: data.metadata?.img_url,
        })
      } catch {
        player.addToQueue(trackId)
      }
    }

    const hash = window.location.hash
    if (hash.startsWith('#song=')) {
      const id = hash.slice(6)
      loadFromUrl(id)
      if (isValidTrackId(id)) {
        navigate(`/song/${normalizeTrackId(id)}`, { replace: true })
      }
    } else if (urlTrackId) {
      loadFromUrl(urlTrackId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL when current track changes
  useEffect(() => {
    const id = player.currentTrack?.id
    if (id) {
      navigate(`/song/${id}`, { replace: true })
    } else if (window.location.pathname.startsWith('/song/')) {
      navigate('/', { replace: true })
    }
  }, [player.currentTrack?.id, navigate])

  useEffect(() => {
    localStorage.setItem('melodai_translation_language', translationLanguage)
  }, [translationLanguage])

  useEffect(() => {
    localStorage.setItem('melodai_translation_mode', translationMode)
  }, [translationMode])

  useEffect(() => {
    const trackId = player.currentTrack?.id
    setTranslation(null)
    if (!trackId) return

    let cancelled = false
    setTranslationLoading(true)
    tracksApi.lyricTranslation(trackId, translationLanguage)
      .then(data => {
        if (!cancelled) setTranslation(data.available ? data : null)
      })
      .catch(() => {
        if (!cancelled) setTranslation(null)
      })
      .finally(() => {
        if (!cancelled) setTranslationLoading(false)
      })

    return () => { cancelled = true }
  }, [player.currentTrack?.id, translationLanguage])

  const handleTranslate = useCallback(async () => {
    const trackId = player.currentTrack?.id
    if (!trackId) return
    setTranslationLoading(true)
    try {
      const data = await tracksApi.createLyricTranslation(trackId, translationLanguage)
      setTranslation(data.available ? data : null)
      if (data.available && translationMode === 'original') setTranslationMode('both')
    } finally {
      setTranslationLoading(false)
    }
  }, [player.currentTrack?.id, translationLanguage, translationMode])

  const handleSearchSelect = useCallback((id: string, meta: { title: string; artist: string; img_url: string | null }) => {
    player.addToQueue(id, meta, true)
  }, [player])

  const handleAddToQueue = useCallback((id: string, meta: { title: string; artist: string; img_url: string | null }) => {
    player.addToQueue(id, meta)
  }, [player])

  const handlePlayNow = useCallback(async (id: string, meta: { title: string; artist: string; img_url: string | null }) => {
    await player.addToQueue(id, meta)
    const idx = player.queue.findIndex(q => q.id === id)
    if (idx >= 0 && player.queue[idx].ready) {
      player.playIndex(idx)
    }
  }, [player])

  const handleRandom = useCallback(async () => {
    const exclude = player.queue.map(q => q.id)
    try {
      const data = await tracksApi.random(exclude)
      if (data.id) {
        player.addToQueue(data.id, {
          title: data.metadata?.title,
          artist: data.metadata?.artist,
          img_url: data.metadata?.img_url,
        })
      }
    } catch {
      // No songs available
    }
  }, [player])

  const handleLogout = useCallback(async () => {
    await logout()
    navigate('/login')
  }, [logout, navigate])

  if (!checked || !authenticated) return null

  const currentTrackId = player.currentTrack?.id
  const isFavorite = currentTrackId ? player.favorites.has(currentTrackId) : false

  const thumbnail = player.currentTrack?.thumbnail

  return (
    <div className={styles.layout}>
      <Sidebar
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
        queueContent={
          <QueuePanel
            queue={player.queue}
            currentIndex={player.currentIndex}
            onPlay={player.playIndex}
            onRemove={player.removeFromQueue}
            onReorder={player.reorderQueue}
            onRetry={player.retryTrack}
            onRandom={handleRandom}
            onShuffle={player.shuffle}
            onClear={player.clearQueue}
          />
        }
        libraryContent={
          <LibraryPanel
            onAddToQueue={handleAddToQueue}
            onPlayNow={handlePlayNow}
            favorites={player.favorites}
            onToggleFavorite={player.toggleFavorite}
            onSearchDeezer={(q) => searchRef.current?.search(q)}
          />
        }
      />

      <main className={styles.main}>
        <div
          className={`${styles.albumBackdrop} ${thumbnail ? styles.albumBackdropVisible : ''}`}
          style={thumbnail ? { '--album-art': `url(${thumbnail})` } as React.CSSProperties : undefined}
        />
        <Header
          username={username}
          displayName={displayName}
          isAdmin={isAdmin}
          credits={credits}
          searchBar={<SearchBar ref={searchRef} onSelect={handleSearchSelect} />}
          onThemeToggle={toggleTheme}
          onLogout={handleLogout}
          onMenuOpen={() => setSidebarOpen(true)}
        />

        <div className={styles.content}>
          {player.currentIndex >= 0 ? (
            <>
              <NowPlaying
                track={player.currentTrack}
                isFavorite={isFavorite}
                onToggleFavorite={player.toggleFavorite}
              />
              <LyricsView
                lyrics={player.lyrics}
                loading={player.lyricsLoading}
                currentTime={player.currentTime}
                duration={player.duration}
                onSeek={player.seek}
                onEditWord={player.editWord}
                hasTrack
                translation={translation}
                translationLanguage={translationLanguage}
                translationMode={translationMode}
                translationLoading={translationLoading}
                onTranslationLanguageChange={setTranslationLanguage}
                onTranslationModeChange={setTranslationMode}
                onTranslate={handleTranslate}
              />
            </>
          ) : (
            <SuggestedSongs onSelect={handleSearchSelect} />
          )}
        </div>

        <Controls
          isPlaying={player.isPlaying}
          currentTime={player.currentTime}
          duration={player.duration}
          analyserRef={player.analyserRef}
          thumbnail={player.currentTrack?.thumbnail}
          initialVocalsVolume={player.initialVocalsVolume}
          initialInstrumentalVolume={player.initialInstrumentalVolume}
          onTogglePlay={player.togglePlay}
          onSeek={player.seek}
          onPrev={player.prev}
          onNext={player.next}
          onVocalsVolume={player.setVocalsVolume}
          onInstrumentalVolume={player.setInstrumentalVolume}
        />
      </main>
    </div>
  )
}
