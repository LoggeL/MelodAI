import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHeart as faHeartSolid, faPlus, faRotateRight, faRecordVinyl, faArrowUpRightFromSquare, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { faHeart as faHeartRegular } from '@fortawesome/free-regular-svg-icons'
import { tracks } from '../../services/api'
import type { LibraryTrack, ProcessingStatus } from '../../types'
import { useToast } from '../../hooks/useToast'
import { HeartButton } from '../HeartButton/HeartButton'
import { PageState } from '../common/PageState'
import styles from './LibraryPanel.module.css'

const ACTIVE_STATUSES = new Set(['pending', 'queued', 'metadata', 'downloading', 'splitting', 'lyrics', 'processing'])

interface Props {
  onAddToQueue: (id: string, meta: { title: string; artist: string; img_url: string | null }) => void
  onPlayNow: (id: string, meta: { title: string; artist: string; img_url: string | null }) => void
  favorites?: Set<string>
  onToggleFavorite?: (trackId: string) => void
  onSearchDeezer?: (query: string) => void
}

export function LibraryPanel({ onAddToQueue, favorites, onToggleFavorite, onSearchDeezer }: Props) {
  const navigate = useNavigate()
  const [songs, setSongs] = useState<LibraryTrack[]>([])
  const [filter, setFilter] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)
  const [statuses, setStatuses] = useState<Record<string, ProcessingStatus>>({})
  const [statusCheck, setStatusCheck] = useState<'pending' | 'ready' | 'unavailable'>('pending')
  const [showFavsOnly, setShowFavsOnly] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const data = await tracks.library()
      if (request !== requestRef.current) return
      setStatuses({})
      setStatusCheck('pending')
      setSongs(data)
      setLoaded(true)
    } catch (err) {
      if (request === requestRef.current) setError(err instanceof Error ? err.message : 'Could not load the library.')
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => { requestRef.current += 1 }
  }, [load])

  // Only active work needs polling. Failed or untracked files stay visible without
  // repeatedly requesting status, and manual refresh restarts discovery.
  useEffect(() => {
    const incomplete = songs.filter(song => !song.complete)
    if (!incomplete.length) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const request = requestRef.current
    const stale = () => cancelled || request !== requestRef.current
    const poll = async () => {
      try {
        const queue = await tracks.status() as Record<string, ProcessingStatus>
        if (stale()) return
        setStatuses(queue)
        setStatusCheck('ready')
        if (incomplete.some(song => ['complete', 'ready'].includes(queue[song.id]?.status))) {
          const library = await tracks.library()
          if (stale()) return
          const completed = new Map(library.filter(song => song.complete).map(song => [song.id, song]))
          setSongs(previous => previous.some(song => !song.complete && completed.has(song.id))
            ? previous.map(song => !song.complete ? completed.get(song.id) || song : song)
            : previous)
        }
        failures = 0
        if (incomplete.some(song => ACTIVE_STATUSES.has(queue[song.id]?.status))) {
          timer = setTimeout(() => void poll(), 5000)
        }
      } catch {
        if (stale()) return
        setStatusCheck('unavailable')
        failures += 1
        // A network outage must not leave an endless polling loop or an active
        // processing indicator. The refresh control remains available.
        if (failures < 3) timer = setTimeout(() => void poll(), Math.min(5000 * 2 ** failures, 30000))
      }
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [songs])

  const filtered = useMemo(() => {
    let result = songs
    if (showFavsOnly && favorites) {
      result = result.filter(s => favorites.has(s.id))
    }
    if (filter.trim()) {
      const q = filter.trim().toLowerCase()
      result = result.filter(s =>
        s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) => a.title.localeCompare(b.title))
  }, [songs, filter, showFavsOnly, favorites])

  const handleAddAll = useCallback(() => {
    const ready = filtered.filter(s => s.complete).slice(0, 50)
    if (!ready.length) return
    ready.forEach(s => onAddToQueue(s.id, { title: s.title, artist: s.artist, img_url: s.img_url }))
    toast.success(`Added ${ready.length} songs to queue`)
  }, [filtered, onAddToQueue, toast])

  return (
    <>
      <div className={styles.controls}>
        <input
          type="search"
          aria-label="Filter library songs"
          className={styles.filterInput}
          placeholder="Filter library..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {favorites && (
          <button
            className={`${styles.iconBtn} ${showFavsOnly ? styles.iconBtnActive : ''}`}
            onClick={() => setShowFavsOnly(!showFavsOnly)}
            title="Show favorites only"
            aria-label="Show favorites only"
            aria-pressed={showFavsOnly}
          >
            <FontAwesomeIcon icon={showFavsOnly ? faHeartSolid : faHeartRegular} />
          </button>
        )}
        <button type="button" className={styles.iconBtn} disabled={loading} onClick={load} title="Refresh" aria-label="Refresh library">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
        <button type="button" className={styles.iconBtn} disabled={!filtered.some(song => song.complete)} onClick={handleAddAll} title="Add up to 50 ready songs to queue" aria-label="Add up to 50 ready songs to queue">
          <FontAwesomeIcon icon={faPlus} />
        </button>
        <button className={styles.iconBtn} onClick={() => navigate('/library')} title="Open full library" aria-label="Open full library">
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
        </button>
      </div>

      <div className={styles.grid}>
        {error && <PageState title="Library unavailable" description={error} action={<button type="button" className={styles.searchDeezerBtn} onClick={load} disabled={loading}>Try again</button>} />}
        {!loaded && loading && Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.skeletonItem}>
            <div className={styles.skeletonThumb} />
            <div className={styles.skeletonInfo}>
              <div className={styles.skeletonTitle} />
              <div className={styles.skeletonArtist} />
            </div>
            <div className={styles.skeletonDot} />
          </div>
        ))}
        {filtered.length === 0 && loaded && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}><FontAwesomeIcon icon={faRecordVinyl} /></div>
            <h3>{filter.trim() ? 'No matches' : showFavsOnly ? 'No favorites yet' : 'No songs yet'}</h3>
            <p>{filter.trim() ? `No songs matching "${filter.trim()}"` : showFavsOnly ? 'Heart some songs to see them here' : 'Process songs to build your library'}</p>
            {filter && onSearchDeezer && (
              <button
                className={styles.searchDeezerBtn}
                onClick={() => onSearchDeezer(filter)}
              >
                <FontAwesomeIcon icon={faMagnifyingGlass} /> Search Deezer
              </button>
            )}
          </div>
        )}
        {filtered.map(song => {
          const isFav = favorites?.has(song.id)
          const status = statuses[song.id]
          const failed = !song.complete && status?.status === 'error'
          const processing = !song.complete && statusCheck === 'ready' && ACTIVE_STATUSES.has(status?.status)
          const progress = Math.round(Math.min(100, Math.max(0, status?.progress || 0)))
          const statusLabel = song.complete ? 'Ready' : failed ? 'Processing failed'
            : processing ? `Processing · ${progress}%`
            : statusCheck === 'pending' ? 'Checking status'
            : statusCheck === 'unavailable' ? 'Status unavailable' : 'Not ready'
          return (
            <div key={song.id} className={styles.item}>
              <button type="button" className={styles.songButton} disabled={!song.complete}
                onClick={() => onAddToQueue(song.id, { title: song.title, artist: song.artist, img_url: song.img_url })}
                aria-label={song.complete ? `Add ${song.title} by ${song.artist} to queue` : `${song.title}: ${statusLabel}`}
                title={song.complete ? 'Add to queue' : failed ? status?.detail || statusLabel : statusLabel}>
                <span className={`${styles.thumbWrap} ${isFav ? styles.thumbFav : ''}`}>
                  <img className={styles.thumb} src={song.img_url || '/logo.svg'} alt="" loading="lazy" />
                </span>
                <span className={styles.info}>
                  <span className={styles.title}>{song.title}</span>
                  <span className={styles.artist}>{song.artist}</span>
                  {!song.complete && <span className={`${styles.statusText} ${failed ? styles.failedText : ''}`}>{statusLabel}</span>}
                </span>
                <span className={`${styles.status} ${song.complete ? styles.complete : failed ? styles.failed : processing ? styles.incomplete : styles.unknown}`} aria-hidden="true" />
              </button>
              {onToggleFavorite && (
                <HeartButton
                  active={!!isFav}
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(song.id) }}
                  className={styles.addBtn}
                  activeClassName={styles.favActive}
                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
