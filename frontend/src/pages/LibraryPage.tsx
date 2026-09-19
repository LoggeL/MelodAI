import { useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faRotateRight, faHeart, faMagnifyingGlass, faPlus,
  faTableCells, faList, faVolumeLow, faTrash, faMusic,
  faCoins, faGlobe, faListUl, faChevronLeft,
} from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../hooks/useAuth'
import { tracks } from '../services/api'
import { useToast } from '../hooks/useToast'
import { Modal } from '../components/common/Modal'
import { PageState } from '../components/common/PageState'
import { TrackCollection } from './library/TrackCollection'
import { hiResCover } from './library/trackPresentation'
import { useLibraryData } from './library/useLibraryData'
import { useCatalogSearch } from './library/useCatalogSearch'
import { usePreview } from './library/usePreview'
import type { LibraryTrack, Playlist, SearchResult } from '../types'
import styles from './LibraryPage.module.css'

type LibraryTab = 'all' | 'favorites' | 'playlists'

export function LibraryPage() {
  const navigate = useNavigate()
  const { checked, authenticated } = useAuth()
  const toast = useToast()
  const [filter, setFilter] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [activeTab, setActiveTab] = useState<LibraryTab>('all')
  const [viewingPlaylistId, setViewingPlaylistId] = useState<number | null>(null)
  const [addingSongsToPlaylist, setAddingSongsToPlaylist] = useState(false)
  const [addSongsFilter, setAddSongsFilter] = useState('')
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [deletePlaylist, setDeletePlaylist] = useState<Playlist | null>(null)
  const [addToPlaylistSongId, setAddToPlaylistSongId] = useState<string | null>(null)
  const [searchMode, setSearchMode] = useState<'filter' | 'add'>('filter')
  const [deezerQuery, setDeezerQuery] = useState('')
  const [pending, setPending] = useState<Set<string>>(new Set())
  const pendingRef = useRef(new Set<string>())
  const data = useLibraryData(checked && authenticated, viewingPlaylistId)
  const { songs, favorites, playlists, credits, statuses, playlistTracks } = data
  const preview = usePreview()
  const search = useCatalogSearch(deezerQuery, searchMode === 'add')

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    if (pendingRef.current.has(key)) return
    pendingRef.current.add(key)
    setPending(new Set(pendingRef.current))
    try { await action() } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The action failed. Please try again.')
    } finally {
      pendingRef.current.delete(key)
      setPending(new Set(pendingRef.current))
    }
  }, [toast])

  const baseSongs = useMemo(() => viewingPlaylistId !== null ? playlistTracks
    : activeTab === 'favorites' ? songs.filter(song => favorites.has(song.id)) : songs,
  [viewingPlaylistId, playlistTracks, activeTab, songs, favorites])

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase()
    const rank = (song: LibraryTrack) => song.complete ? 2 : statuses[song.id]?.status === 'error' ? 0 : 1
    return baseSongs.filter(song => !query || `${song.title} ${song.artist}`.toLowerCase().includes(query))
      .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
  }, [baseSongs, filter, statuses])

  const addableSongs = useMemo(() => {
    const ids = new Set(playlistTracks.map(song => song.id))
    const query = addSongsFilter.trim().toLowerCase()
    return songs.filter(song => song.complete && !ids.has(song.id)
      && (!query || `${song.title} ${song.artist}`.toLowerCase().includes(query)))
  }, [songs, playlistTracks, addSongsFilter])

  const selectTab = (tab: LibraryTab) => {
    preview.stopPreview()
    setActiveTab(tab)
    setViewingPlaylistId(null)
    setAddingSongsToPlaylist(false)
    setFilter('')
    setSearchMode('filter')
  }

  const toggleFavorite = (id: string) => void run(`favorite:${id}`, async () => {
    const active = favorites.has(id)
    if (active) await tracks.removeFavorite(id)
    else await tracks.addFavorite(id)
    data.setFavorites(previous => {
      const updated = new Set(previous)
      if (active) updated.delete(id)
      else updated.add(id)
      return updated
    })
  })

  const addToPlaylist = (playlistId: number, songId: string) => void run('playlist', async () => {
    await tracks.addToPlaylist(playlistId, songId)
    setAddToPlaylistSongId(null)
    toast.success('Song is in the playlist')
    await data.refreshPlaylists()
    if (viewingPlaylistId === playlistId) await data.loadPlaylist(playlistId)
  })

  const createPlaylist = () => void run('playlist', async () => {
    const name = newPlaylistName.trim()
    if (!name) return
    const result = await tracks.createPlaylist(name)
    data.setPlaylists(previous => [...previous, { ...result, track_count: 0, created_at: new Date().toISOString() }])
    setCreatingPlaylist(false)
    setNewPlaylistName('')
    if (addToPlaylistSongId) {
      // Keep the newly created empty playlist visible if adding the song fails.
      await tracks.addToPlaylist(result.id, addToPlaylistSongId)
      setAddToPlaylistSongId(null)
      await data.refreshPlaylists()
      toast.success(`Created "${name}" and added the song`)
    } else toast.success(`Created "${name}"`)
  })

  const removeFromPlaylist = () => void run('playlist', async () => {
    if (viewingPlaylistId === null || addToPlaylistSongId === null) return
    await tracks.removeFromPlaylist(viewingPlaylistId, addToPlaylistSongId)
    setAddToPlaylistSongId(null)
    toast.success('Removed from playlist')
    await Promise.all([data.refreshPlaylists(), data.loadPlaylist(viewingPlaylistId)])
  })

  const confirmDeletePlaylist = () => void run('delete-playlist', async () => {
    if (!deletePlaylist) return
    await tracks.deletePlaylist(deletePlaylist.id)
    data.setPlaylists(previous => previous.filter(playlist => playlist.id !== deletePlaylist.id))
    if (viewingPlaylistId === deletePlaylist.id) selectTab('playlists')
    setDeletePlaylist(null)
    toast.success(`Deleted "${deletePlaylist.name}"`)
  })

  const addSong = (song: SearchResult) => void run(`add:${song.id}`, async () => {
    const response = await tracks.add(song.id)
    if (response.error || response.status === 'error') throw new Error(response.error || 'Could not add the song.')
    const ready = response.status === 'complete' || response.status === 'ready'
    data.setSongs(previous => previous.some(track => track.id === song.id) ? previous : [{
      id: song.id, title: song.title, artist: song.artist, album: song.album,
      duration: 0, img_url: song.img_url, complete: ready,
    }, ...previous])
    toast.success(ready ? `Added "${song.title}"` : `Processing "${song.title}"`)
    try { data.setCredits((await tracks.credits()).credits) } catch { /* Keep the successful addition visible. */ }
  })

  const retrySong = (id: string) => void run(`retry:${id}`, async () => {
    const response = await tracks.add(id)
    if (response.error || response.status === 'error') throw new Error(response.error || 'Could not retry this song.')
    data.setStatuses(previous => ({ ...previous, [id]: { status: response.status, progress: response.progress || 0, detail: 'Queued', updated_at: new Date().toISOString() } }))
    toast.success('Song queued for processing')
  })

  const refresh = () => {
    void data.load()
    if (viewingPlaylistId !== null) void data.loadPlaylist(viewingPlaylistId)
  }

  if (!checked) return <PageState title="Loading library" loading />
  if (!authenticated) return <Navigate to="/login" replace state={{ from: '/library' }} />

  const readyCount = songs.filter(song => song.complete).length
  const failedCount = songs.filter(song => !song.complete && statuses[song.id]?.status === 'error').length
  const processingCount = songs.length - readyCount - failedCount
  const favCount = songs.filter(song => favorites.has(song.id)).length
  const viewingPlaylist = playlists.find(playlist => playlist.id === viewingPlaylistId)
  const isPlaylistDetail = viewingPlaylistId !== null
  const showSongViews = activeTab !== 'playlists' || isPlaylistDetail
  const playlistBusy = pending.has('playlist')
  const selectedSong = songs.find(song => song.id === addToPlaylistSongId)

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <Link to="/" className={styles.backBtn} aria-label="Back to player" title="Back to player"><FontAwesomeIcon icon={faArrowLeft} /></Link>
          <div className={styles.headerInfo}>
            <h1 className={styles.title}>Library</h1>
            <p className={styles.subtitle}>{readyCount} song{readyCount !== 1 ? 's' : ''} ready
              {processingCount > 0 && <> · {processingCount} processing</>}{failedCount > 0 && <> · {failedCount} failed</>}
            </p>
          </div>
          {credits !== null && <div className={styles.creditsBadge} title="Available credits"><FontAwesomeIcon icon={faCoins} /><span>{credits} credits</span></div>}
          <button type="button" className={styles.refreshBtn} onClick={refresh} disabled={data.loading || data.playlistLoading} aria-label="Refresh library" title="Refresh library"><FontAwesomeIcon icon={faRotateRight} /></button>
        </header>

        {data.error && <PageState title="Could not load library" description={data.error} action={<button type="button" className={styles.primaryButton} onClick={refresh} disabled={data.loading}>Try again</button>} />}
        {!data.loaded && data.loading && <PageState title="Loading your library" loading />}
        {data.loaded && <>
          <nav className={styles.pillRow} aria-label="Library views">
            <button type="button" className={`${styles.pill} ${activeTab === 'all' ? styles.pillActive : ''}`} aria-pressed={activeTab === 'all'} onClick={() => selectTab('all')}><FontAwesomeIcon icon={faMusic} /> All songs</button>
            <button type="button" className={`${styles.pill} ${activeTab === 'favorites' ? styles.pillActive : ''}`} aria-pressed={activeTab === 'favorites'} onClick={() => selectTab('favorites')}><FontAwesomeIcon icon={faHeart} /> Favorites <span className={styles.pillCount}>{favCount}</span></button>
            <button type="button" className={`${styles.pill} ${activeTab === 'playlists' ? styles.pillActive : ''}`} aria-pressed={activeTab === 'playlists'} onClick={() => selectTab('playlists')}><FontAwesomeIcon icon={faListUl} /> Playlists <span className={styles.pillCount}>{playlists.length}</span></button>
          </nav>

          {isPlaylistDetail && viewingPlaylist && <div className={styles.playlistDetailHeader}>
            <button type="button" className={styles.playlistBackBtn} onClick={() => selectTab('playlists')}><FontAwesomeIcon icon={faChevronLeft} /> Playlists</button>
            <div className={styles.playlistDetailInfo}><h2 className={styles.playlistDetailName}>{viewingPlaylist.name}</h2><span className={styles.playlistDetailCount}>{viewingPlaylist.track_count} tracks</span></div>
            <button type="button" className={styles.playlistAddSongsBtn} onClick={() => { setAddingSongsToPlaylist(true); setAddSongsFilter('') }} disabled={data.playlistLoading || !!data.playlistError} aria-haspopup="dialog"><FontAwesomeIcon icon={faPlus} /> Add songs</button>
            <button type="button" className={styles.playlistDeleteBtn} onClick={() => setDeletePlaylist(viewingPlaylist)} aria-label={`Delete playlist ${viewingPlaylist.name}`} title="Delete playlist"><FontAwesomeIcon icon={faTrash} /></button>
          </div>}

          {!showSongViews && <section aria-label="Your playlists">
            <div className={styles.playlistsGrid}>
              {playlists.map(playlist => <article key={playlist.id} className={styles.playlistCard}>
                <button type="button" className={styles.playlistOpenButton} onClick={() => { setViewingPlaylistId(playlist.id); setFilter('') }} aria-label={`Open ${playlist.name}, ${playlist.track_count} tracks`}>
                  <span className={styles.playlistCardMosaic}><FontAwesomeIcon icon={faListUl} /></span>
                  <span className={styles.playlistCardBody}><span className={styles.playlistCardName}>{playlist.name}</span><span className={styles.playlistCardCount}>{playlist.track_count} track{playlist.track_count !== 1 ? 's' : ''}</span></span>
                </button>
                <button type="button" className={styles.playlistCardDelete} onClick={() => setDeletePlaylist(playlist)} aria-label={`Delete playlist ${playlist.name}`} title="Delete playlist"><FontAwesomeIcon icon={faTrash} /></button>
              </article>)}
              <button type="button" className={styles.playlistNewCard} onClick={() => { setCreatingPlaylist(true); setNewPlaylistName('') }} aria-haspopup="dialog"><span className={styles.playlistNewCardIcon}><FontAwesomeIcon icon={faPlus} /></span><span className={styles.playlistNewCardLabel}>New playlist</span></button>
            </div>
            {playlists.length === 0 && <PageState title="No playlists yet" description="Create a playlist to keep your favorite karaoke sets together." />}
          </section>}

          {showSongViews && <>
            <div className={styles.toolbar}>
              <div className={styles.searchWrap}>
                <FontAwesomeIcon icon={searchMode === 'add' ? faGlobe : faMagnifyingGlass} className={styles.searchIcon} />
                <input type="search" className={styles.searchInput} aria-label={searchMode === 'add' ? 'Search Deezer for songs' : 'Filter library songs'} placeholder={searchMode === 'add' ? 'Search Deezer to add songs...' : 'Filter songs by title or artist...'} value={searchMode === 'add' ? deezerQuery : filter} onChange={e => searchMode === 'add' ? setDeezerQuery(e.target.value) : setFilter(e.target.value)} />
              </div>
              <button type="button" className={`${styles.modeToggle} ${styles.modeToggleLabel} ${searchMode === 'add' ? styles.modeToggleActive : ''}`} onClick={() => { preview.stopPreview(); setSearchMode(searchMode === 'filter' ? 'add' : 'filter'); setFilter('') }} aria-pressed={searchMode === 'add'}><FontAwesomeIcon icon={searchMode === 'add' ? faMusic : faPlus} /><span>{searchMode === 'add' ? 'Library' : 'Add songs'}</span></button>
              {preview.previewId !== null && <div className={`${styles.volumeWrap} ${styles.volumeWrapVisible}`}><FontAwesomeIcon icon={faVolumeLow} /><input type="range" min={0} max={100} value={preview.previewVolume} onChange={e => preview.setPreviewVolume(Number(e.target.value))} className={styles.volumeSlider} aria-label="Preview volume" aria-valuetext={`${preview.previewVolume}%`} /></div>}
              {searchMode === 'filter' && <div className={styles.viewToggle} role="group" aria-label="Song layout">
                <button type="button" className={`${styles.viewToggleBtn} ${viewMode === 'grid' ? styles.viewToggleBtnActive : ''}`} aria-label="Grid view" aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')} title="Grid view"><FontAwesomeIcon icon={faTableCells} /></button>
                <button type="button" className={`${styles.viewToggleBtn} ${viewMode === 'list' ? styles.viewToggleBtnActive : ''}`} aria-label="List view" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')} title="List view"><FontAwesomeIcon icon={faList} /></button>
              </div>}
            </div>

            {searchMode === 'add' ? <section aria-label="Deezer search results">
              {deezerQuery.trim().length < 2 ? <PageState title="Find your next song" description="Enter at least two characters to search by title or artist." />
                : search.loading ? <PageState title="Searching Deezer" loading />
                : search.error ? <PageState title="Search unavailable" description={search.error} action={<button type="button" className={styles.primaryButton} onClick={search.retry}>Try again</button>} />
                : search.results.length === 0 ? <PageState title="No songs found" description="Try a different title or artist." /> : <>
                  <p className={styles.searchResultsHeader} role="status">{search.results.length} songs found</p>
                  <div className={styles.grid}>{search.results.map(song => {
                    const inLibrary = songs.some(track => track.id === song.id)
                    const busy = pending.has(`add:${song.id}`)
                    return <article key={song.id} className={styles.card}>
                      <div className={styles.cardArt}><img src={hiResCover(song.img_url)} alt="" loading="lazy" /></div>
                      <div className={styles.cardBody}><h3 className={styles.cardTitle} title={song.title}>{song.title}</h3><div className={styles.cardArtist}>{song.artist}</div></div>
                      <div className={styles.cardActions}><button type="button" className={styles.deezerAddBtn} disabled={inLibrary || busy} onClick={() => addSong(song)}>{inLibrary ? 'In library' : busy ? 'Adding...' : <><FontAwesomeIcon icon={faPlus} /> Add to library</>}</button></div>
                    </article>
                  })}</div>
                </>}
            </section> : data.playlistLoading ? <PageState title="Loading playlist" loading />
              : data.playlistError ? <PageState title="Could not load playlist" description={data.playlistError} action={<button type="button" className={styles.primaryButton} onClick={refresh}>Try again</button>} />
              : filtered.length === 0 ? <PageState
                title={filter.trim() ? 'No matching songs' : isPlaylistDetail ? 'This playlist is empty' : activeTab === 'favorites' ? 'No favorites yet' : 'Your library is empty'}
                description={filter.trim() ? 'Try another title or artist, or clear the filter.' : isPlaylistDetail ? 'Add songs from your library to build this playlist.' : activeTab === 'favorites' ? 'Use the heart button on a song to save it here.' : 'Search Deezer to add your first karaoke song.'}
                action={filter.trim() ? <button type="button" className={styles.secondaryButton} onClick={() => setFilter('')}>Clear filter</button> : !isPlaylistDetail && activeTab === 'all' ? <button type="button" className={styles.primaryButton} onClick={() => setSearchMode('add')}>Find songs</button> : undefined} />
              : <TrackCollection songs={filtered} viewMode={viewMode} favorites={favorites} statuses={statuses} pending={pending}
                previewId={preview.previewId} previewProgress={preview.previewProgress} onPlay={song => { preview.stopPreview(); navigate(`/song/${encodeURIComponent(song.id)}`) }} onFavorite={toggleFavorite} onPreview={preview.togglePreview} onPlaylist={id => { setAddToPlaylistSongId(id); setNewPlaylistName('') }} onRetry={retrySong} />}
          </>}
        </>}
      </div>

      {creatingPlaylist && <Modal title="Create playlist" onClose={() => setCreatingPlaylist(false)} busy={playlistBusy} size="small"
        footer={<><button type="button" className={styles.secondaryButton} onClick={() => setCreatingPlaylist(false)} disabled={playlistBusy}>Cancel</button><button type="submit" form="create-playlist" className={styles.primaryButton} disabled={!newPlaylistName.trim() || playlistBusy}>{playlistBusy ? 'Creating...' : 'Create playlist'}</button></>}>
        <form id="create-playlist" onSubmit={e => { e.preventDefault(); createPlaylist() }} className={styles.dialogForm}>
          <label htmlFor="playlist-name">Playlist name</label><input id="playlist-name" autoFocus maxLength={100} value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)} required className={styles.dialogInput} disabled={playlistBusy} />
        </form>
      </Modal>}

      {deletePlaylist && <Modal title="Delete playlist?" onClose={() => setDeletePlaylist(null)} busy={pending.has('delete-playlist')} size="small"
        footer={<><button type="button" className={styles.secondaryButton} onClick={() => setDeletePlaylist(null)} disabled={pending.has('delete-playlist')}>Cancel</button><button type="button" className={styles.dangerButton} onClick={confirmDeletePlaylist} disabled={pending.has('delete-playlist')}>{pending.has('delete-playlist') ? 'Deleting...' : 'Delete playlist'}</button></>}>
        <p>Delete "{deletePlaylist.name}"? The songs will stay in your library.</p>
      </Modal>}

      {addToPlaylistSongId && <Modal title="Playlist options" onClose={() => setAddToPlaylistSongId(null)} busy={playlistBusy} size="small">
        <p className={styles.dialogDescription}>{selectedSong?.title || 'Selected song'}</p>
        <div className={styles.playlistChoices}>{playlists.length === 0 ? <p className={styles.dialogDescription}>Create your first playlist below.</p> : playlists.map(playlist => <button type="button" key={playlist.id} className={styles.playlistChoice} disabled={playlistBusy} onClick={() => addToPlaylist(playlist.id, addToPlaylistSongId)}><FontAwesomeIcon icon={faPlus} /> {playlist.name}</button>)}</div>
        {isPlaylistDetail && <button type="button" className={styles.dangerButton} onClick={removeFromPlaylist} disabled={playlistBusy}><FontAwesomeIcon icon={faTrash} /> Remove from this playlist</button>}
        <form className={styles.dialogForm} onSubmit={e => { e.preventDefault(); createPlaylist() }}>
          <label htmlFor="new-playlist-name">New playlist name</label><input id="new-playlist-name" maxLength={100} required value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)} className={styles.dialogInput} disabled={playlistBusy} />
          <button type="submit" className={styles.primaryButton} disabled={!newPlaylistName.trim() || playlistBusy}>{playlistBusy ? 'Saving...' : 'Create playlist and add song'}</button>
        </form>
      </Modal>}

      {addingSongsToPlaylist && viewingPlaylistId !== null && <Modal title={`Add songs to ${viewingPlaylist?.name || 'playlist'}`} onClose={() => setAddingSongsToPlaylist(false)} busy={playlistBusy}>
        <label className={styles.dialogForm}>Filter library songs<input type="search" className={styles.dialogInput} autoFocus value={addSongsFilter} onChange={e => setAddSongsFilter(e.target.value)} placeholder="Title or artist" /></label>
        <div className={styles.addSongsList}>
          {addableSongs.length === 0 ? <PageState title={addSongsFilter.trim() ? 'No matching songs' : 'No songs available'} description={addSongsFilter.trim() ? 'Try another title or artist.' : 'Songs must finish processing before you can add them. Songs already in this playlist are hidden.'} />
            : addableSongs.map(song => <div key={song.id} className={styles.addSongRow}>
              <img src={song.img_url || '/logo.svg'} alt="" className={styles.addSongThumb} loading="lazy" />
              <div className={styles.addSongInfo}><div className={styles.addSongTitle}>{song.title}</div><div className={styles.addSongArtist}>{song.artist}</div></div>
              <button type="button" className={styles.addSongBtn} onClick={() => addToPlaylist(viewingPlaylistId, song.id)} disabled={playlistBusy} aria-label={`Add ${song.title} to playlist`}><FontAwesomeIcon icon={faPlus} /></button>
            </div>)}
        </div>
      </Modal>}
    </main>
  )
}
