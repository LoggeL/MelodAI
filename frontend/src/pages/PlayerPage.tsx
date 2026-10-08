import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react'
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
import { StageError, StageProcessing } from '../components/Player/StageStatus'
import { SetlistHead } from '../components/Queue/SetlistHead'
import { Cover } from '../components/common/Cover'
import { de } from '../utils/messages'
import { lineStarts, lyricPauses, lyricsNote } from '../utils/lyricsTimeline'
import { readLyricScale, storeLyricScale } from '../utils/lyricScale'
import styles from './PlayerPage.module.css'

const SETLIST_KEY = 'setlistCollapsed'
function readCollapsed() {
  try { return localStorage.getItem(SETLIST_KEY) === '1' } catch { return false }
}

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
      showToast(error instanceof Error ? de(error.message) : 'Abmelden fehlgeschlagen.', 'error')
    }
  }, [logout, navigate])
  if (!checked) return <PageState loading title="Sitzung wird geladen …" />
  if (!authenticated) return <Navigate to="/login" replace state={{ from: !signingOut && trackId ? `/song/${trackId}` : '/' }} />
  return <PlayerContent key={username} onLogout={handleLogout} />
}

function PlayerContent({ onLogout }: { onLogout: () => Promise<void> }) {
  const navigate = useNavigate()
  const { trackId: urlTrackId } = useParams()
  const { authenticated, username, displayName, isAdmin, credits, setCredits } = useAuth()
  const { theme, toggle: toggleTheme } = useTheme()
  const playerOptions = useMemo(() => ({
    accountKey: username,
    isAdmin,
    onCreditsUpdate: setCredits,
  }), [username, isAdmin, setCredits])
  const player = usePlayer(playerOptions)
  const albumStyle = useAlbumColors(player.currentTrack?.thumbnail)
  const searchRef = useRef<SearchBarHandle>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const [setlistCollapsed, setSetlistCollapsed] = useState(readCollapsed)
  const changeCollapsed = useCallback((collapsed: boolean) => {
    setSetlistCollapsed(collapsed)
    try { localStorage.setItem(SETLIST_KEY, collapsed ? '1' : '0') } catch { /* Storage is optional. */ }
  }, [])
  const [lyricScale, setLyricScale] = useState(readLyricScale)
  const changeLyricScale = useCallback((scale: number) => { setLyricScale(scale); storeLyricScale(scale) }, [])
  const [stageMode, setStageMode] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
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
      if (requestVersion === translationRequest.current) showToast(error instanceof Error ? de(error.message) : 'Die Übersetzung ist fehlgeschlagen.', 'error')
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
      showToast(error instanceof Error ? de(error.message) : 'Gerade sind keine Songs verfügbar.', 'warning')
    }
  }, [player])

  const currentTrack = player.currentTrack
  const currentTrackId = currentTrack?.id
  const isFavorite = currentTrackId ? player.favorites.has(currentTrackId) : false
  const lyrics = player.lyrics
  const note = useMemo(() => lyricsNote(lyrics), [lyrics])
  const starts = useMemo(() => lineStarts(lyrics), [lyrics])
  const pauses = useMemo(() => lyricPauses(lyrics, player.duration), [lyrics, player.duration])
  const vocalsVolume = player.initialVocalsVolume ?? 100
  const instrumentalVolume = player.initialInstrumentalVolume ?? 100
  const queue = player.queue
  const nextTrack = player.currentIndex >= 0
    ? queue.slice(player.currentIndex + 1).find(item => item.ready) ?? queue[player.currentIndex + 1]
    : undefined
  // Without a current song, show the song that is being prepared (e.g. a fresh deep link).
  const pendingTrack = player.currentIndex < 0 ? [...queue].reverse().find(item => !item.ready && !item.error) : undefined
  let failedIndex = -1
  if (player.currentIndex < 0 && !pendingTrack) for (let i = queue.length - 1; i >= 0 && failedIndex < 0; i--) if (queue[i].error) failedIndex = i
  const playable = !!currentTrack?.ready
  const openSearch = useCallback(() => searchRef.current?.open(), [])

  const changeStageMode = useCallback((enter: boolean) => {
    setStageMode(enter)
    setChromeVisible(true)
    try {
      if (enter && !document.fullscreenElement) void document.documentElement.requestFullscreen?.()?.catch(() => {})
      else if (!enter && document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => {})
    } catch { /* Fullscreen is optional. */ }
  }, [])

  // Bühnenmodus: Esc leaves, the chrome fades after 3 s without pointer or key input.
  useEffect(() => {
    if (!stageMode) return
    let timer = setTimeout(() => setChromeVisible(false), 3000)
    const wake = () => {
      setChromeVisible(true)
      clearTimeout(timer)
      timer = setTimeout(() => setChromeVisible(false), 3000)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); changeStageMode(false); return }
      wake()
    }
    const onFullscreen = () => { if (!document.fullscreenElement) setStageMode(false) }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFullscreen)
    }
  }, [stageMode, changeStageMode])

  useEffect(() => { if (!playable && stageMode) changeStageMode(false) }, [playable, stageMode, changeStageMode])

  let stage
  if (currentTrack?.error) {
    stage = <StageError track={currentTrack} onRetry={() => void player.retryTrack(player.currentIndex)} />
  } else if (currentTrack && !currentTrack.ready) {
    stage = <StageProcessing track={currentTrack} />
  } else if (currentTrack) {
    stage = (
      <>
        {!stageMode && (
          <NowPlaying
            track={currentTrack}
            isFavorite={isFavorite}
            onToggleFavorite={player.toggleFavorite}
            lyricsNote={note}
            translation={translation}
            translationLanguage={translationLanguage}
            translationMode={translationMode}
            translationLoading={translationLoading}
            onTranslationLanguageChange={setTranslationLanguage}
            onTranslationModeChange={setTranslationMode}
            onTranslate={handleTranslate}
            lyricScale={lyricScale}
            onLyricScale={changeLyricScale}
          />
        )}
        <LyricsView
          lyrics={lyrics}
          loading={player.lyricsLoading}
          currentTime={player.currentTime}
          isPlaying={player.isPlaying}
          duration={player.duration}
          onSeek={player.seek}
          onEditWord={player.editWord}
          hasTrack
          translation={translation}
          translationMode={translationMode}
          vocalsMuted={vocalsVolume === 0}
          lang={translation?.source_language || 'de'}
          stageMode={stageMode}
        />
      </>
    )
  } else if (pendingTrack) {
    stage = <StageProcessing track={pendingTrack} />
  } else if (failedIndex >= 0) {
    stage = <StageError track={queue[failedIndex]} onRetry={() => void player.retryTrack(failedIndex)} onRemove={() => player.removeFromQueue(failedIndex)} />
  } else {
    stage = <SuggestedSongs onSelect={handleSearchSelect} onSearch={openSearch} />
  }

  const layoutStyle = { '--setlist-current': setlistCollapsed ? '44px' : 'var(--setlist-w)' } as CSSProperties
  const stageStyle = { ...albumStyle, '--lyric-user': lyricScale } as CSSProperties

  return (
    <div className={styles.layout} style={layoutStyle}
      data-mode={stageMode ? 'tv' : undefined} data-theme={stageMode ? 'dark' : undefined}
      data-chrome={stageMode && !chromeVisible ? 'hidden' : undefined}
      data-setlist={setlistCollapsed ? 'collapsed' : 'open'}>
      <Header
        username={username}
        displayName={displayName}
        isAdmin={isAdmin}
        credits={credits}
        searchBar={<SearchBar ref={searchRef} onSelect={handleSearchSelect} credits={credits} isAdmin={isAdmin} currentId={currentTrackId} queue={queue} />}
        theme={theme}
        onThemeToggle={toggleTheme}
        onLogout={onLogout}
        onMenuOpen={() => setSidebarOpen(true)}
        setlistCount={queue.length}
      />

      <main className={styles.main} inert={sidebarOpen}>
        <section className={styles.stage} style={stageStyle} aria-label="Bühne">
          <div className={`${styles.backdrop} ${currentTrack?.thumbnail ? styles.backdropOn : ''}`} aria-hidden="true" />
          <div className={styles.beam} aria-hidden="true" />
          {playable && <div className={styles.pool} aria-hidden="true" />}
          {stageMode && currentTrack && (
            <div className={`${styles.tvTop} ${styles.chrome}`}>
              <div className={styles.tvNow}>
                <Cover className={styles.tvCover} src={currentTrack.thumbnail} />
                <div className={styles.tvMeta}>
                  <strong>{currentTrack.title}</strong>
                  <span>{currentTrack.artist}</span>
                </div>
              </div>
              {nextTrack && (
                <div className={styles.tvNext}>
                  <span className="kicker">Danach auf der Bühne</span>
                  <strong>{nextTrack.title}</strong>
                  <span>{nextTrack.artist}</span>
                </div>
              )}
            </div>
          )}
          <div className={styles.stageContent}>{stage}</div>
        </section>

        <div className={`${styles.desk} ${stageMode ? styles.chrome : ''}`}>
          <Controls
            disabled={!playable}
            isPlaying={player.isPlaying}
            currentTime={player.currentTime}
            duration={player.duration}
            vocalsVolume={vocalsVolume}
            instrumentalVolume={instrumentalVolume}
            onTogglePlay={player.togglePlay}
            onSeek={player.seek}
            onPrev={player.prev}
            onNext={player.next}
            onVocalsVolume={player.setVocalsVolume}
            onInstrumentalVolume={player.setInstrumentalVolume}
            lineStarts={starts}
            pauses={pauses}
            lyricScale={lyricScale}
            onLyricScale={changeLyricScale}
            stageMode={stageMode}
            onStageMode={changeStageMode}
          />
        </div>
      </main>

      <Sidebar
        mobileOpen={sidebarOpen}
        onMobileClose={closeSidebar}
        collapsed={setlistCollapsed}
        onCollapsedChange={changeCollapsed}
        queueCount={queue.length}
        isAdmin={isAdmin}
        theme={theme}
        onThemeToggle={toggleTheme}
        onLogout={onLogout}
        head={<SetlistHead count={queue.length} onRandom={handleRandom} onShuffle={player.shuffle} onClear={player.clearQueue} />}
        queueContent={
          <QueuePanel
            queue={queue}
            currentIndex={player.currentIndex}
            onPlay={player.playIndex}
            onRemove={player.removeFromQueue}
            onReorder={player.reorderQueue}
            onRetry={player.retryTrack}
            onRandom={handleRandom}
            onSearch={() => { closeSidebar(); openSearch() }}
          />
        }
        libraryContent={
          <LibraryPanel
            onAddToQueue={handleAddToQueue}
            onPlayNow={handlePlayNow}
            favorites={player.favorites}
            onToggleFavorite={player.toggleFavorite}
            onSearchDeezer={(q) => { closeSidebar(); searchRef.current?.search(q) }}
          />
        }
      />
    </div>
  )
}
