import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { usePlayer } from '../hooks/usePlayer'
import { useSync } from '../hooks/useSync'
import type { SyncState, SyncCommand } from '../hooks/useSync'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useAlbumColors } from '../hooks/useAlbumColors'
import { PageState } from '../components/common/PageState'
import { showToast } from '../hooks/useToast'
import { queueSnapshot } from '../utils/queue'
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
  const { checked, authenticated, username, logout } = useAuth()
  const { trackId } = useParams()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const handleLogout = useCallback(async () => {
    setSigningOut(true)
    try {
      await logout()
      navigate('/login', { replace: true, state: { from: '/' } })
    } catch (error) {
      setSigningOut(false)
      showToast(error instanceof Error ? error.message : 'Unable to sign out', 'error')
    }
  }, [logout, navigate])
  if (!checked) return <PageState loading title="Loading your session" />
  if (!authenticated) return <Navigate to="/login" replace state={{ from: !signingOut && trackId ? `/song/${trackId}` : '/' }} />
  return <PlayerContent key={username} onLogout={handleLogout} />
}

function PlayerContent({ onLogout }: { onLogout: () => Promise<void> }) {
  const navigate = useNavigate()
  const { trackId: urlTrackId } = useParams()
  const { authenticated, username, displayName, isAdmin, credits, setCredits } = useAuth()
  const { toggle: toggleTheme } = useTheme()
  const playerOptions = useMemo(() => ({
    accountKey: username,
    isAdmin,
    onCreditsUpdate: setCredits,
  }), [username, isAdmin, setCredits])
  const player = usePlayer(playerOptions)
  useAlbumColors(player.currentTrack?.thumbnail)
  const searchRef = useRef<SearchBarHandle>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const [translationLanguage, setTranslationLanguage] = useState<TranslationLanguage>(() => {
    let stored: string | null = null
    try { stored = localStorage.getItem('melodai_translation_language') } catch { /* Storage is optional. */ }
    if (stored === 'de' || stored === 'en') return stored
    const browserLanguage = navigator.language.toLowerCase().split('-')[0]
    return browserLanguage === 'en' ? 'en' : 'de'
  })
  const [translationMode, setTranslationMode] = useState<'original' | 'translation' | 'both'>(() => {
    let stored: string | null = null
    try { stored = localStorage.getItem('melodai_translation_mode') } catch { /* Storage is optional. */ }
    return stored === 'translation' || stored === 'both' ? stored : 'original'
  })
  const translationRequest = useRef(0)
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
      const snapshot = queueSnapshot(player.queue, player.currentIndex)
      sync.pushQueue(
        snapshot.items,
        snapshot.currentIndex,
        player.isPlaying,
      )
    }
    player.syncCommandRef.current = (cmd: string, payload?: Record<string, unknown>) => {
      sync.sendCommand(cmd, payload ?? {})
    }
    player.syncPlaybackIntentRef.current = sync.markPlaybackIntent
  }, [player, sync])

  const playerRef = useRef(player)
  playerRef.current = player
  const routeRequestRef = useRef<{ id: string; previousId?: string } | null>(null)
  const handledRouteRef = useRef<string | null>(null)
  const selectionRouteRef = useRef<string | null>(null)
  const urlTrackIdRef = useRef(urlTrackId)
  urlTrackIdRef.current = urlTrackId

  // An explicit song route selects the song, including after in-app navigation.
  useEffect(() => {
    const hash = window.location.hash
    if (hash.startsWith('#song=')) {
      const legacyId = hash.slice(6)
      navigate(isValidTrackId(legacyId) ? `/song/${normalizeTrackId(legacyId)}` : '/', { replace: true })
      return
    }
    if (!urlTrackId) { handledRouteRef.current = null; return }
    if (!isValidTrackId(urlTrackId)) {
      routeRequestRef.current = null
      navigate('/', { replace: true })
      return
    }
    const id = normalizeTrackId(urlTrackId)
    const current = playerRef.current
    if (handledRouteRef.current === id || (selectionRouteRef.current === id && current.currentTrack?.id === id)) return
    handledRouteRef.current = id
    selectionRouteRef.current = null
    routeRequestRef.current = { id, previousId: current.currentTrack?.id }
    void current.addToQueue(id, undefined, true)
    return () => { handledRouteRef.current = null }
  }, [urlTrackId, navigate])

  // Keep deep links stable while their audio is being prepared.
  useEffect(() => {
    const id = player.currentTrack?.id
    const requested = routeRequestRef.current
    if (requested && id !== requested.id && id === requested.previousId) return
    routeRequestRef.current = null
    if (id && urlTrackIdRef.current !== id) { selectionRouteRef.current = id; navigate(`/song/${id}`, { replace: true }) }
    else if (!id && !requested && window.location.pathname.startsWith('/song/')) navigate('/', { replace: true })
  }, [player.currentTrack?.id, navigate])

  useEffect(() => {
    try { localStorage.setItem('melodai_translation_language', translationLanguage) } catch { /* Storage is optional. */ }
  }, [translationLanguage])

  useEffect(() => {
    try { localStorage.setItem('melodai_translation_mode', translationMode) } catch { /* Storage is optional. */ }
  }, [translationMode])

  useEffect(() => {
    const trackId = player.currentTrack?.id
    const requestVersion = ++translationRequest.current
    setTranslation(null)
    if (!trackId) { setTranslationLoading(false); return }

    let cancelled = false
    setTranslationLoading(true)
    tracksApi.lyricTranslation(trackId, translationLanguage)
      .then(data => {
        if (!cancelled && requestVersion === translationRequest.current) setTranslation(data.available ? data : null)
      })
      .catch(() => {
        if (!cancelled && requestVersion === translationRequest.current) setTranslation(null)
      })
      .finally(() => {
        if (!cancelled && requestVersion === translationRequest.current) setTranslationLoading(false)
      })

    return () => { cancelled = true }
  }, [player.currentTrack?.id, translationLanguage])

  const handleTranslate = useCallback(async () => {
    const trackId = player.currentTrack?.id
    if (!trackId) return
    const requestVersion = ++translationRequest.current
    setTranslationLoading(true)
    try {
      const data = await tracksApi.createLyricTranslation(trackId, translationLanguage)
      if (requestVersion !== translationRequest.current) return
      setTranslation(data.available ? data : null)
      if (data.available && translationMode === 'original') setTranslationMode('both')
    } catch (error) {
      if (requestVersion === translationRequest.current) showToast(error instanceof Error ? error.message : 'Unable to translate lyrics', 'error')
    } finally {
      if (requestVersion === translationRequest.current) setTranslationLoading(false)
    }
  }, [player.currentTrack?.id, translationLanguage, translationMode])

  const handleSearchSelect = useCallback((id: string, meta: { title: string; artist: string; img_url: string | null }) => {
    player.addToQueue(id, meta, true)
  }, [player])

  const handleAddToQueue = useCallback((id: string, meta: { title: string; artist: string; img_url: string | null }) => {
    player.addToQueue(id, meta)
  }, [player])

  const handlePlayNow = useCallback((id: string, meta: { title: string; artist: string; img_url: string | null }) => {
    void player.addToQueue(id, meta, true)
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
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'No songs available', 'warning')
    }
  }, [player])

  const currentTrackId = player.currentTrack?.id
  const isFavorite = currentTrackId ? player.favorites.has(currentTrackId) : false

  const thumbnail = player.currentTrack?.thumbnail

  return (
    <div className={styles.layout}>
      <Sidebar
        mobileOpen={sidebarOpen}
        onMobileClose={closeSidebar}
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

      <main className={styles.main} inert={sidebarOpen}>
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
          onLogout={onLogout}
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
                isPlaying={player.isPlaying}
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
          disabled={!player.currentTrack?.ready}
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
