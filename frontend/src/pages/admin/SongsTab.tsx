import { errorMessage } from '../account/errors'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRotateRight, faTrash } from '@fortawesome/free-solid-svg-icons'
import { admin } from '../../services/api'
import { PageState } from '../../components/common/PageState'
import type { AdminSong } from '../../types'
import { ConfirmAction, type Confirmation } from './AdminAction'
import styles from '../AdminPage.module.css'

export function SongsTab() {
  const [songs, setSongs] = useState<AdminSong[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
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
  const filtered = songs.filter(song => `${song.title} ${song.artist}`.toLowerCase().includes(query))
  const pages = Math.max(1, Math.ceil(filtered.length / 20))
  const currentPage = Math.min(page, pages)
  if (loading) return <PageState title="Loading songs" loading />
  if (error) return <PageState title="Could not load songs" description={error} action={<button className={styles.primaryBtn} onClick={load}>Try again</button>} />
  return <section className={styles.section}>
    <h2>Songs</h2>
    <div className={styles.filters}><label className={styles.fieldLabel}>Search songs<input className={styles.filterInput} placeholder="Song or artist" value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }} /></label><span className={styles.pageInfo} role="status">{filtered.length} {filtered.length === 1 ? 'song' : 'songs'}</span></div>
    {filtered.length === 0 && <PageState title={query ? 'No matching songs' : 'No processed songs yet'} description={query ? 'Try another title or artist.' : 'Songs will appear here after processing starts.'} />}
    {filtered.slice((currentPage - 1) * 20, currentPage * 20).map(song => <div key={song.id} className={styles.songItem}>
      <Link className={styles.songLink} to={'/admin/songs/' + song.id}><img className={styles.songThumb} src={song.img_url || '/logo.svg'} alt="" loading="lazy" /><div className={styles.songInfo}><div className={styles.songTitle}>{song.title}</div><div className={styles.songArtist}>{song.artist}</div></div></Link>
      <div className={styles.songBadges}><span className={`${styles.tag} ${song.complete ? styles.tagSuccess : styles.tagWarning}`}>{song.complete ? 'Complete' : 'Incomplete'}</span>
        {song.avg_confidence != null && <span className={styles.subtle} title="Average lyric transcription confidence">{(song.avg_confidence * 100).toFixed(0)}% confidence</span>}
        {song.complete && !song.has_lyrics && <span className={`${styles.tag} ${styles.tagDanger}`}>No lyrics</span>}
        <span className={styles.subtle}>{(Object.values(song.file_sizes).reduce((a, b) => a + b, 0) / 1048576).toFixed(1)} MB</span>
      </div>
      <div className={styles.rowActions}>
        <button className={styles.actionBtn} aria-label={`Reprocess ${song.title}`} title="Reprocess song" onClick={() => setConfirmation({ title: `Reprocess ${song.title}?`, description: 'This replaces the generated audio and lyrics and may use paid processing services.', label: 'Reprocess song', action: () => admin.reprocessSong(song.id), success: 'Reprocessing started' })}><FontAwesomeIcon icon={faRotateRight} /></button>
        <button className={`${styles.actionBtn} ${styles.dangerBtn}`} aria-label={`Delete ${song.title}`} title="Delete song" onClick={() => setConfirmation({ title: `Delete ${song.title}?`, description: 'The song and its generated audio and lyrics will be removed for everyone. This cannot be undone.', label: 'Delete song', action: () => admin.deleteSong(song.id), success: 'Song deleted' })}><FontAwesomeIcon icon={faTrash} /></button>
      </div>
    </div>)}
    {pages > 1 && <nav className={styles.pagination} aria-label="Song pages"><button className={styles.actionBtn} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span className={styles.pageInfo}>Page {currentPage} of {pages}</span><button className={styles.actionBtn} disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
    {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={load} />}
  </section>
}
