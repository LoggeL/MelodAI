import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlayer } from '../hooks/usePlayer'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useAlbumColors } from '../hooks/useAlbumColors'
import { tracks as tracksApi } from '../services/api'
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

  useEffect(() => {
    if (checked && !authenticated) {
      const returnTo = urlTrackId ? `/song/${urlTrackId}` : undefined
      navigate('/login', { state: returnTo ? { from: returnTo } : undefined })
    }
  }, [checked, authenticated, navigate, urlTrackId])

  // Load song from URL on mount (route param or legacy hash)
  useEffect(() => {
    async function loadFromUrl(id: string) {
      try {
        const data = await tracksApi.info(id)
        player.addToQueue(id, {
          title: data.metadata?.title,
          artist: data.metadata?.artist,
          img_url: data.metadata?.img_url,
        }, true)
      } catch {
        player.addToQueue(id, undefined, true)
      }
    }

    const hash = window.location.hash
    if (hash.startsWith('#song=')) {
      const id = hash.slice(6)
      loadFromUrl(id)
      navigate(`/song/${id}`, { replace: true })
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

  const handleSearchSelect = useCallback((id: string, meta: { title: string; artist: string; img_url: string }) => {
    player.addToQueue(id, meta)
  }, [player])

  const handlePlayNow = useCallback(async (id: string, meta: { title: string; artist: string; img_url: string }) => {
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
            onAddToQueue={handleSearchSelect}
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
                onSeek={player.seek}
                onEditWord={player.editWord}
                hasTrack
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
          karaokeMode={player.karaokeMode}
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
          onToggleKaraoke={player.toggleKaraokeMode}
        />
      </main>
    </div>
  )
}
