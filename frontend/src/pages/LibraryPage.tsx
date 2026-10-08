import { useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { tracks } from '../services/api'
import { useToast } from '../hooks/useToast'
import { Modal } from '../components/common/Modal'
import { PageState } from '../components/common/PageState'
import { AppShell } from '../components/Layout/AppShell'
import { Icon } from '../components/common/Icon'
import { Cover } from '../components/common/Cover'
import { PlaylistMosaic } from '../components/Library/PlaylistMosaic'
import { CustomSelect } from '../components/common/CustomSelect'
import { de } from '../utils/messages'
import { formatDuration } from '../utils/format'
import { TrackCollection } from './library/TrackCollection'
import { useLibraryData } from './library/useLibraryData'
import { useCatalogSearch } from './library/useCatalogSearch'
import { usePreview } from './library/usePreview'
import type { LibraryTrack, Playlist, SearchResult } from '../types'
import styles from './LibraryPage.module.css'

type LibraryTab = 'all' | 'favorites' | 'playlists'
type SortKey = 'title' | 'artist' | 'status'

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'status', label: 'Bereit zuerst' },
  { value: 'title', label: 'Titel A–Z' },
  { value: 'artist', label: 'Interpret A–Z' },
]
const VIEW_KEY = 'libraryView'
function readView(): 'grid' | 'list' {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
}

export function LibraryPage() {
  const navigate = useNavigate()
  const { checked, authenticated } = useAuth()
  const toast = useToast()
  const [filter, setFilter] = useState('')
  const [viewMode, setViewModeState] = useState<'grid' | 'list'>(readView)
  const setViewMode = (mode: 'grid' | 'list') => {
    setViewModeState(mode)
    try { localStorage.setItem(VIEW_KEY, mode) } catch { /* Storage is optional. */ }
  }
  const [sort, setSort] = useState<SortKey>('status')
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
  const { songs, favorites, playlists, statuses, playlistTracks } = data
  const preview = usePreview()
  const search = useCatalogSearch(deezerQuery, searchMode === 'add')

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    if (pendingRef.current.has(key)) return
    pendingRef.current.add(key)
    setPending(new Set(pendingRef.current))
    try { await action() } catch (err) {
      toast.error(err instanceof Error ? de(err.message) : 'Das hat nicht geklappt. Bitte versuch es noch einmal.')
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
    const compare = (a: LibraryTrack, b: LibraryTrack) => sort === 'artist'
      ? a.artist.localeCompare(b.artist, 'de') || a.title.localeCompare(b.title, 'de')
      : sort === 'title' ? a.title.localeCompare(b.title, 'de')
      : rank(b) - rank(a) || a.title.localeCompare(b.title, 'de')
    return baseSongs.filter(song => !query || `${song.title} ${song.artist}`.toLowerCase().includes(query)).sort(compare)
  }, [baseSongs, filter, statuses, sort])

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
    toast.success('Song ist in der Playlist.')
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
      toast.success(`„${name}“ erstellt und Song hinzugefügt.`)
    } else toast.success(`„${name}“ erstellt.`)
  })

  const removeFromPlaylist = () => void run('playlist', async () => {
    if (viewingPlaylistId === null || addToPlaylistSongId === null) return
    await tracks.removeFromPlaylist(viewingPlaylistId, addToPlaylistSongId)
    setAddToPlaylistSongId(null)
    toast.success('Aus der Playlist entfernt.')
    await Promise.all([data.refreshPlaylists(), data.loadPlaylist(viewingPlaylistId)])
  })

  const confirmDeletePlaylist = () => void run('delete-playlist', async () => {
    if (!deletePlaylist) return
    await tracks.deletePlaylist(deletePlaylist.id)
    data.setPlaylists(previous => previous.filter(playlist => playlist.id !== deletePlaylist.id))
    if (viewingPlaylistId === deletePlaylist.id) selectTab('playlists')
    setDeletePlaylist(null)
    toast.success(`„${deletePlaylist.name}“ gelöscht.`)
  })

  const addSong = (song: SearchResult) => void run(`add:${song.id}`, async () => {
    const response = await tracks.add(song.id)
    if (response.error || response.status === 'error') throw new Error(response.error || 'Der Song konnte nicht hinzugefügt werden.')
    const ready = response.status === 'complete' || response.status === 'ready'
    data.setSongs(previous => previous.some(track => track.id === song.id) ? previous : [{
      id: song.id, title: song.title, artist: song.artist, album: song.album,
      duration: 0, img_url: song.img_url, complete: ready,
    }, ...previous])
    toast.success(ready ? `„${song.title}“ hinzugefügt.` : `„${song.title}“ wird vorbereitet.`)
    try { data.setCredits((await tracks.credits()).credits) } catch { /* Keep the successful addition visible. */ }
  })

  const retrySong = (id: string) => void run(`retry:${id}`, async () => {
    const response = await tracks.add(id)
    if (response.error || response.status === 'error') throw new Error(response.error || 'Der Song konnte nicht erneut gestartet werden.')
    data.setStatuses(previous => ({ ...previous, [id]: { status: response.status, progress: response.progress || 0, detail: 'In der Warteschlange', updated_at: new Date().toISOString() } }))
    toast.success('Song wird erneut verarbeitet.')
  })

  const refresh = () => {
    void data.load()
    if (viewingPlaylistId !== null) void data.loadPlaylist(viewingPlaylistId)
  }

  if (!checked) return <PageState title="Bibliothek wird geladen …" loading />
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
  const addMode = searchMode === 'add'
  const toggleAddMode = () => { preview.stopPreview(); setSearchMode(addMode ? 'filter' : 'add'); setFilter(''); if (activeTab === 'playlists' && !isPlaylistDetail) setActiveTab('all') }

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <span className="kicker">Bibliothek · {readyCount} {readyCount === 1 ? 'Song' : 'Songs'} bereit
            {processingCount > 0 && <> · {processingCount} in Arbeit</>}{failedCount > 0 && <> · {failedCount} fehlgeschlagen</>}</span>
          <h1>{addMode ? 'Songs hinzufügen' : 'Bibliothek'}</h1>
          <p>{addMode ? 'Such im Katalog. Neue Songs kosten 5 Credits und sind nach ca. 2 Minuten singbar.' : 'Alles, was schon getrennt und getimt ist. Sofort singbar.'}</p>
        </div>
        <div className="page-head__end">
          <button type="button" className="iconbtn iconbtn--outline" onClick={refresh} disabled={data.loading || data.playlistLoading} aria-label="Bibliothek aktualisieren" title="Aktualisieren"><Icon name="redo" /></button>
          <button type="button" className={`btn ${addMode ? '' : 'btn--primary'}`} aria-pressed={addMode} onClick={toggleAddMode}>
            {addMode ? <><Icon name="library" /> Zur Bibliothek</> : <><Icon name="plus" /> Songs hinzufügen</>}
          </button>
        </div>
      </header>

      {data.error && <PageState error title="Die Bibliothek konnte nicht geladen werden." description={de(data.error)} action={<button type="button" className="btn" onClick={refresh} disabled={data.loading}><Icon name="redo" /> Erneut versuchen</button>} />}
      {!data.loaded && data.loading && <div className={styles.skeletonGrid} aria-busy="true" aria-label="Bibliothek wird geladen">
        {Array.from({ length: 12 }, (_, i) => <div key={i} className={styles.skeletonCard}><div className={`skeleton ${styles.skeletonArt}`} /><div className={`skeleton ${styles.skeletonLine}`} /><div className={`skeleton ${styles.skeletonLine} ${styles.short}`} /></div>)}
      </div>}
      {data.loaded && <>
        <div className={`${styles.toolbar} ${addMode ? styles.toolbarAdd : ''}`}>
          {!addMode && <nav className={`seg ${styles.tabs}`} aria-label="Ansichten">
            <button type="button" className={styles.tab} aria-pressed={activeTab === 'all' && !isPlaylistDetail} onClick={() => selectTab('all')}>Alle Songs <span className="count">{songs.length}</span></button>
            <button type="button" className={styles.tab} aria-pressed={activeTab === 'favorites'} onClick={() => selectTab('favorites')}>Favoriten <span className="count">{favCount}</span></button>
            <button type="button" className={styles.tab} aria-pressed={activeTab === 'playlists'} onClick={() => selectTab('playlists')}>Playlists <span className="count">{playlists.length}</span></button>
          </nav>}
          {showSongViews && <div className={styles.tools}>
            <label className={styles.searchWrap}>
              <span className="sr-only">{addMode ? 'Im Katalog suchen' : 'Bibliothek filtern'}</span>
              <Icon name={addMode ? 'search' : 'filter'} size={18} className={styles.searchIcon} />
              <input type="search" className={styles.filterInput} autoFocus={addMode}
                placeholder={addMode ? 'Song oder Interpret im Katalog suchen' : 'Titel oder Interpret filtern'}
                value={addMode ? deezerQuery : filter} onChange={e => addMode ? setDeezerQuery(e.target.value) : setFilter(e.target.value)} />
            </label>
            {preview.previewId !== null && <label className={styles.volume}>
              <Icon name="volume" size={18} />
              <span className="sr-only">Lautstärke Vorhören</span>
              <input type="range" min={0} max={100} value={preview.previewVolume} onChange={e => preview.setPreviewVolume(Number(e.target.value))}
                aria-valuetext={`${preview.previewVolume} Prozent`} />
            </label>}
            {!addMode && <>
              <CustomSelect className={`input ${styles.sort}`} aria-label="Sortierung" value={sort} onChange={value => setSort(value as SortKey)} options={SORTS} />
              <div className="seg" role="group" aria-label="Darstellung">
                <button type="button" aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')} title="Raster"><Icon name="grid" size={18} /><span className={styles.viewLabel}>Raster</span></button>
                <button type="button" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')} title="Liste"><Icon name="rows" size={18} /><span className={styles.viewLabel}>Liste</span></button>
              </div>
            </>}
          </div>}
        </div>

        {isPlaylistDetail && viewingPlaylist && <div className={styles.playlistHead}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => selectTab('playlists')}><Icon name="chevron-left" size={16} /> Playlists</button>
          <div className={styles.playlistTitle}><h2>{viewingPlaylist.name}</h2><span className="mono">{viewingPlaylist.track_count} {viewingPlaylist.track_count === 1 ? 'Song' : 'Songs'}</span></div>
          <div className={styles.playlistActions}>
            <button type="button" className="btn" onClick={() => { setAddingSongsToPlaylist(true); setAddSongsFilter('') }} disabled={data.playlistLoading || !!data.playlistError} aria-haspopup="dialog"><Icon name="plus" /> Songs hinzufügen</button>
            <button type="button" className="iconbtn iconbtn--outline iconbtn--danger" onClick={() => setDeletePlaylist(viewingPlaylist)} aria-label={`Playlist ${viewingPlaylist.name} löschen`} title="Playlist löschen"><Icon name="trash" /></button>
          </div>
        </div>}

        {!showSongViews && <section aria-label="Deine Playlists">
          {playlists.length === 0 ? <PageState icon="list" title="Noch keine Playlists." description="Sammle deine Lieblingssongs für den nächsten Abend."
            action={<button type="button" className="btn btn--primary" onClick={() => { setCreatingPlaylist(true); setNewPlaylistName('') }}><Icon name="plus" /> Playlist erstellen</button>} />
            : <div className={styles.grid}>
              {playlists.map(playlist => <article key={playlist.id} className={styles.playlistCard}>
                <button type="button" className={styles.playlistOpen} onClick={() => { setViewingPlaylistId(playlist.id); setFilter('') }} aria-label={`${playlist.name} öffnen, ${playlist.track_count} Songs`}>
                  <PlaylistMosaic covers={playlist.covers} className={styles.mosaic} />
                  <span className={styles.playlistName}>{playlist.name}</span>
                  <span className={styles.playlistCount}>{playlist.track_count} {playlist.track_count === 1 ? 'Song' : 'Songs'}</span>
                </button>
                <button type="button" className={`iconbtn iconbtn--sm ${styles.playlistDelete}`} onClick={() => setDeletePlaylist(playlist)} aria-label={`Playlist ${playlist.name} löschen`} title="Playlist löschen"><Icon name="trash" size={18} /></button>
              </article>)}
              <button type="button" className={styles.newPlaylist} onClick={() => { setCreatingPlaylist(true); setNewPlaylistName('') }} aria-haspopup="dialog">
                <Icon name="plus" size={28} /><span>Neue Playlist</span>
              </button>
            </div>}
        </section>}

        {showSongViews && (addMode ? <section aria-label="Suchergebnisse im Katalog">
          {deezerQuery.trim().length < 2 ? <PageState icon="search" title="Finde deinen nächsten Song." description="Gib mindestens zwei Zeichen ein, Titel oder Interpret." />
            : search.loading ? <PageState title={`Sucht nach „${deezerQuery.trim()}“ …`} loading />
            : search.error ? <PageState error title="Die Suche ist gerade nicht erreichbar." description={search.error} action={<button type="button" className="btn" onClick={search.retry}><Icon name="redo" /> Erneut versuchen</button>} />
            : search.results.length === 0 ? <PageState icon="search" title={`Nichts gefunden für „${deezerQuery.trim()}“.`} description="Versuch’s mit dem Interpreten oder einer anderen Schreibweise." /> : <>
              <p className={styles.resultsHead} role="status">{search.results.length} Treffer</p>
              <div className="table-wrap">
                <table className="table table--cards">
                  <thead><tr><th scope="col"><span className="sr-only">Cover</span></th><th scope="col">Titel</th><th scope="col">Album</th><th scope="col" className="num">Dauer</th><th scope="col"><span className="sr-only">Aktion</span></th></tr></thead>
                  <tbody>{search.results.map(song => {
                    const inLibrary = songs.some(track => track.id === song.id)
                    const busy = pending.has(`add:${song.id}`)
                    return <tr key={song.id}>
                      <td className={styles.thumbCell} data-label=""><Cover className={styles.listThumb} src={song.img_url} /></td>
                      <td className="cell-main" data-label=""><div className={styles.listTitle}>{song.title}</div><div className={styles.listArtist}>{song.artist}</div></td>
                      <td data-label="Album" className={styles.albumCell}>{song.album}</td>
                      <td data-label="Dauer" className={`num cell-inline ${styles.durationCell}`}>{song.duration ? formatDuration(song.duration) : '–:–'}</td>
                      <td className="cell-acts" data-label="">
                        {inLibrary ? <span className="chip chip--ok"><Icon name="check" size={14} /> In der Bibliothek</span>
                          : <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => addSong(song)} aria-label={`${song.title} hinzufügen`}>
                            {busy ? 'Wird hinzugefügt …' : <><Icon name="plus" size={16} /> Hinzufügen</>}
                          </button>}
                      </td>
                    </tr>
                  })}</tbody>
                </table>
              </div>
            </>}
        </section> : data.playlistLoading ? <PageState title="Playlist wird geladen …" loading />
          : data.playlistError ? <PageState error title="Die Playlist konnte nicht geladen werden." description={de(data.playlistError)} action={<button type="button" className="btn" onClick={refresh}><Icon name="redo" /> Erneut versuchen</button>} />
          : filtered.length === 0 ? <PageState
            icon={filter.trim() ? 'filter' : activeTab === 'favorites' && !isPlaylistDetail ? 'heart' : 'library'}
            title={filter.trim() ? `Kein Song passt zu „${filter.trim()}“.` : isPlaylistDetail ? 'Diese Playlist ist noch leer.' : activeTab === 'favorites' ? 'Noch keine Favoriten.' : 'Noch keine Songs.'}
            description={filter.trim() ? 'Probier einen anderen Titel oder Interpreten.' : isPlaylistDetail ? 'Füge Songs aus deiner Bibliothek hinzu.' : activeTab === 'favorites' ? 'Tipp aufs Herz bei einem Song.' : 'Such deinen ersten Song, er landet danach hier.'}
            action={filter.trim() ? <button type="button" className="btn" onClick={() => setFilter('')}>Filter zurücksetzen</button> : !isPlaylistDetail && activeTab === 'all' ? <button type="button" className="btn btn--primary" onClick={() => setSearchMode('add')}><Icon name="plus" /> Songs hinzufügen</button> : undefined} />
          : <TrackCollection songs={filtered} viewMode={viewMode} favorites={favorites} statuses={statuses} pending={pending}
            previewId={preview.previewId} previewProgress={preview.previewProgress} onPlay={song => { preview.stopPreview(); navigate(`/song/${encodeURIComponent(song.id)}`) }} onFavorite={toggleFavorite} onPreview={preview.togglePreview} onPlaylist={id => { setAddToPlaylistSongId(id); setNewPlaylistName('') }} onRetry={retrySong} />)}
      </>}

      {creatingPlaylist && <Modal title="Playlist erstellen" onClose={() => setCreatingPlaylist(false)} busy={playlistBusy} size="small"
        footer={<><button type="button" className="btn" onClick={() => setCreatingPlaylist(false)} disabled={playlistBusy}>Abbrechen</button><button type="submit" form="create-playlist" className="btn btn--primary" disabled={!newPlaylistName.trim() || playlistBusy}>{playlistBusy ? 'Wird erstellt …' : 'Playlist erstellen'}</button></>}>
        <form id="create-playlist" onSubmit={e => { e.preventDefault(); createPlaylist() }} className="field">
          <label htmlFor="playlist-name">Name der Playlist</label><input id="playlist-name" className="input" autoFocus maxLength={100} value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)} required disabled={playlistBusy} />
        </form>
      </Modal>}

      {deletePlaylist && <Modal title="Playlist löschen?" onClose={() => setDeletePlaylist(null)} busy={pending.has('delete-playlist')} size="small"
        footer={<><button type="button" className="btn" onClick={() => setDeletePlaylist(null)} disabled={pending.has('delete-playlist')}>Abbrechen</button><button type="button" className="btn btn--danger-solid" onClick={confirmDeletePlaylist} disabled={pending.has('delete-playlist')}>{pending.has('delete-playlist') ? 'Wird gelöscht …' : 'Playlist löschen'}</button></>}>
        <p>„{deletePlaylist.name}“ wird gelöscht. Die Songs bleiben in deiner Bibliothek.</p>
      </Modal>}

      {addToPlaylistSongId && <Modal title="Zur Playlist" variant="sheet" onClose={() => setAddToPlaylistSongId(null)} busy={playlistBusy} size="small">
        <p className={styles.dialogSong}>{selectedSong?.title || 'Ausgewählter Song'}</p>
        <div className={styles.choices}>{playlists.length === 0 ? <p className={styles.dialogHint}>Erstelle unten deine erste Playlist.</p> : playlists.map(playlist => <button type="button" key={playlist.id} className="btn" disabled={playlistBusy} onClick={() => addToPlaylist(playlist.id, addToPlaylistSongId)}><Icon name="plus" size={16} /> {playlist.name}</button>)}</div>
        {isPlaylistDetail && <button type="button" className="btn btn--danger" onClick={removeFromPlaylist} disabled={playlistBusy}><Icon name="trash" size={16} /> Aus dieser Playlist entfernen</button>}
        <form className={styles.newForm} onSubmit={e => { e.preventDefault(); createPlaylist() }}>
          <div className="field"><label htmlFor="new-playlist-name">Neue Playlist</label><input id="new-playlist-name" className="input" maxLength={100} required value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)} disabled={playlistBusy} /></div>
          <button type="submit" className="btn btn--primary" disabled={!newPlaylistName.trim() || playlistBusy}>{playlistBusy ? 'Wird gespeichert …' : 'Erstellen und Song hinzufügen'}</button>
        </form>
      </Modal>}

      {addingSongsToPlaylist && viewingPlaylistId !== null && <Modal title={`Songs zu „${viewingPlaylist?.name || 'Playlist'}“ hinzufügen`} onClose={() => setAddingSongsToPlaylist(false)} busy={playlistBusy}>
        <label className="field">Bibliothek filtern<input type="search" className="input" autoFocus value={addSongsFilter} onChange={e => setAddSongsFilter(e.target.value)} placeholder="Titel oder Interpret" /></label>
        <div className={styles.addList}>
          {addableSongs.length === 0 ? <PageState icon="library" title={addSongsFilter.trim() ? 'Kein passender Song.' : 'Keine Songs verfügbar.'} description={addSongsFilter.trim() ? 'Probier einen anderen Titel oder Interpreten.' : 'Nur fertige Songs lassen sich hinzufügen. Songs, die schon in der Playlist sind, sind ausgeblendet.'} />
            : addableSongs.map(song => <div key={song.id} className={styles.addRow}>
              <Cover src={song.img_url} className={styles.listThumb} />
              <div><div className={styles.listTitle}>{song.title}</div><div className={styles.listArtist}>{song.artist}</div></div>
              <button type="button" className="iconbtn iconbtn--outline iconbtn--sm" onClick={() => addToPlaylist(viewingPlaylistId, song.id)} disabled={playlistBusy} aria-label={`${song.title} zur Playlist hinzufügen`}><Icon name="plus" size={18} /></button>
            </div>)}
        </div>
      </Modal>}
    </AppShell>
  )
}
