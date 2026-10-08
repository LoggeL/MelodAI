import { errorMessage } from '../account/errors'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { admin } from '../../services/api'
import { Cover } from '../../components/common/Cover'
import { Icon } from '../../components/common/Icon'
import { PageState } from '../../components/common/PageState'
import type { AdminSong } from '../../types'
import { formatBytes, formatInt, formatPercent } from '../../utils/format'
import { ConfirmAction, type Confirmation } from './AdminAction'
import { ResplitPanel } from './ResplitPanel'
import { LoadError, Pagination, SearchField, SectionHead } from './shared'
import styles from '../AdminPage.module.css'

type Filter = 'all' | 'done' | 'incomplete' | 'nolyrics' | 'low'
const LOW = 0.6
const FILE_COUNT = 6

const isLow = (song: AdminSong) => song.avg_confidence != null && song.avg_confidence < LOW
const needsLyrics = (song: AdminSong) => song.complete && !song.has_lyrics
/** „Handlungsbedarf zuerst“: incomplete, then missing lyrics, then low confidence. */
const urgency = (song: AdminSong) => !song.complete ? 0 : needsLyrics(song) ? 1 : isLow(song) ? 2 : 3
const totalSize = (song: AdminSong) => Object.values(song.file_sizes).reduce((a, b) => a + b, 0)
const filesPresent = (song: AdminSong) => Math.min(FILE_COUNT, Object.values(song.file_sizes).filter(size => size > 0).length)

const FILTERS: { key: Filter; label: string; test: (song: AdminSong) => boolean }[] = [
  { key: 'all', label: 'Alle', test: () => true },
  { key: 'done', label: 'Fertig', test: song => song.complete && song.has_lyrics },
  { key: 'incomplete', label: 'Unvollständig', test: song => !song.complete },
  { key: 'nolyrics', label: 'Ohne Lyrics', test: needsLyrics },
  { key: 'low', label: 'Konfidenz < 60 %', test: isLow },
]

export function SongsTab() {
  const [songs, setSongs] = useState<AdminSong[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [status, setStatus] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const requestId = useRef(0)
  const cancelRequest = useCallback(() => { requestId.current++ }, [])
  const load = useCallback(async () => {
    const current = ++requestId.current
    setError('')
    try { const result = await admin.songs(); if (current === requestId.current) setSongs(result) }
    catch (e) { if (current === requestId.current) setError(errorMessage(e)) }
    finally { if (current === requestId.current) setLoading(false) }
  }, [])
  useEffect(() => { void load(); return cancelRequest }, [load, cancelRequest])
  const query = filter.trim().toLowerCase()
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.key, songs.filter(f.test).length])) as Record<Filter, number>, [songs])
  const filtered = useMemo(() => {
    const test = FILTERS.find(f => f.key === status)!.test
    return songs.filter(song => test(song) && `${song.title} ${song.artist} ${song.id}`.toLowerCase().includes(query))
      .map((song, index) => ({ song, index }))
      .sort((a, b) => urgency(a.song) - urgency(b.song) || a.index - b.index)
      .map(entry => entry.song)
  }, [songs, status, query])
  const pages = Math.max(1, Math.ceil(filtered.length / 20))
  const currentPage = Math.min(page, pages)
  const storage = songs.reduce((sum, song) => sum + totalSize(song), 0)
  const confidences = songs.filter(song => song.avg_confidence != null)
  const averageConfidence = confidences.length ? confidences.reduce((sum, song) => sum + (song.avg_confidence ?? 0), 0) / confidences.length : null

  const reprocess = (song: AdminSong) => setConfirmation({ title: `„${song.title}“ neu verarbeiten?`, description: 'Audio und Lyrics werden neu erzeugt. Das kann kostenpflichtige Dienste nutzen.', label: 'Neu verarbeiten', tone: 'neutral', action: () => admin.reprocessSong(song.id), success: 'Verarbeitung gestartet.' })
  const remove = (song: AdminSong) => setConfirmation({ title: `„${song.title}“ löschen?`, description: 'Der Song und alle erzeugten Dateien verschwinden für alle. Das lässt sich nicht rückgängig machen.', label: 'Song löschen', action: () => admin.deleteSong(song.id), success: 'Song gelöscht.' })

  if (loading) return <PageState title="Songs werden geladen …" loading />
  if (error) return <LoadError title="Die Songs konnten nicht geladen werden." error={error} onRetry={load} />
  return <section className={styles.section}>
    <div className={`stats ${styles.statStrip}`}>
      <div className="stat"><b>{formatInt(songs.length)}</b><span className="kicker">Songs</span></div>
      <div className="stat"><b>{formatInt(counts.done)}</b><span className="kicker">Fertig</span></div>
      <div className={`stat ${counts.incomplete ? 'stat--err' : ''}`}><b>{formatInt(counts.incomplete)}</b><span className="kicker">Unvollständig</span></div>
      <div className={`stat ${averageConfidence != null && averageConfidence < LOW ? 'stat--warn' : ''}`}><b>{averageConfidence == null ? '–' : formatPercent(averageConfidence)}</b><span className="kicker">Ø Konfidenz</span></div>
      <div className="stat"><b>{formatBytes(storage)}</b><span className="kicker">Speicher</span></div>
    </div>
    <ResplitPanel onFinished={load} />
    <SectionHead title="Songs" count={filtered.length} />
    <div className={styles.filters}>
      <SearchField label="Songs durchsuchen" placeholder="Titel, Interpret oder ID" value={filter} onChange={value => { setFilter(value); setPage(1) }} />
      <div className="seg" role="group" aria-label="Status filtern">
        {FILTERS.map(f => <button type="button" key={f.key} aria-pressed={status === f.key} onClick={() => { setStatus(f.key); setPage(1) }}>{f.label} <span className="count">{formatInt(counts[f.key])}</span></button>)}
      </div>
    </div>
    {filtered.length === 0 ? <PageState icon="music" title={query || status !== 'all' ? 'Keine passenden Songs.' : 'Noch keine verarbeiteten Songs.'} description={query || status !== 'all' ? 'Versuch einen anderen Suchbegriff oder Filter.' : 'Songs erscheinen hier, sobald die Verarbeitung startet.'} /> : <div className="table-wrap">
      <table className="table table--cards">
        <thead><tr><th scope="col">Song</th><th scope="col">Status</th><th scope="col">Konfidenz</th><th scope="col">Dateien</th><th scope="col" className="num">Größe</th><th scope="col" className="num"><span className="sr-only">Aktionen</span></th></tr></thead>
        <tbody>{filtered.slice((currentPage - 1) * 20, currentPage * 20).map(song => {
          const present = filesPresent(song)
          const broken = !song.complete
          return <tr key={song.id} data-testid="admin-song-row">
            <td className="cell-main"><Link className={styles.songCell} to={'/admin/songs/' + song.id}>
              <Cover src={song.img_url} className={styles.cover} />
              <span className={styles.cellStack}><span className={styles.cellTitle}>{song.title}</span><span className={styles.cellSub}>{song.artist}</span><span className={`${styles.subtle} ${styles.mono}`}>#{song.id}</span></span>
            </Link></td>
            <td data-label="Status" className="cell-inline"><span className={`chip ${broken ? 'chip--err' : needsLyrics(song) ? 'chip--warn' : 'chip--ok'}`}>{broken ? 'Unvollständig' : needsLyrics(song) ? 'Ohne Lyrics' : 'Fertig'}</span>
              {song.separation_backend && <span className={`chip ${styles.sepChip}`} title="Welches Modell Gesang und Instrumental getrennt hat">{song.separation_backend === 'local' ? 'RoFormer' : 'Demucs'}</span>}</td>
            <td data-label="Konfidenz" className="cell-inline">{song.avg_confidence == null ? <span className={styles.subtle}>–</span> : <span className={styles.confidence}>
              <span className={styles.mono}>{formatPercent(song.avg_confidence)}</span>
              <span className={`meter meter--thin ${isLow(song) ? 'meter--warn' : ''}`} aria-hidden="true"><i style={{ '--v': `${Math.round(song.avg_confidence * 100)}%` } as CSSProperties} /></span>
            </span>}</td>
            <td data-label="Dateien" className="cell-inline"><span className={styles.dots} aria-hidden="true">{Array.from({ length: FILE_COUNT }, (_, i) => <i key={i} className={i < present ? styles.on : undefined} />)}</span><span className="sr-only">{present} von {FILE_COUNT} Dateien</span></td>
            <td data-label="Größe" className="num cell-inline">{formatBytes(totalSize(song))}</td>
            <td className={broken ? 'num' : 'cell-acts num'}><div className={styles.tableActions}>
              {broken
                ? <button type="button" className={`${styles.actionBtn} ${styles.reprocessWide}`} onClick={() => reprocess(song)}><Icon name="redo" size={16} /> Neu verarbeiten</button>
                : <button type="button" className={`${styles.actionBtn} ${styles.iconOnly}`} aria-label={`${song.title} neu verarbeiten`} title="Neu verarbeiten" onClick={() => reprocess(song)}><Icon name="redo" size={16} /></button>}
              <button type="button" className={`${styles.actionBtn} ${styles.iconOnly} ${styles.danger}`} aria-label={`${song.title} löschen`} title="Song löschen" onClick={() => remove(song)}><Icon name="trash" size={16} /></button>
            </div></td>
          </tr>
        })}</tbody>
      </table>
    </div>}
    <Pagination page={currentPage} pages={pages} onPage={setPage} label="Seiten der Songliste" />
    {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={load} />}
  </section>
}
