import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHeart as faHeartSolid, faPlus, faRotateRight, faRecordVinyl, faArrowUpRightFromSquare, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { faHeart as faHeartRegular } from '@fortawesome/free-regular-svg-icons'
import { tracks } from '../../services/api'
import type { LibraryTrack } from '../../types'
import { useToast } from '../../hooks/useToast'
import { HeartButton } from '../HeartButton/HeartButton'
import styles from './LibraryPanel.module.css'

interface Props {
  onAddToQueue: (id: string, meta: { title: string; artist: string; img_url: string }) => void
  onPlayNow: (id: string, meta: { title: string; artist: string; img_url: string }) => void
  favorites?: Set<string>
  onToggleFavorite?: (trackId: string) => void
  onSearchDeezer?: (query: string) => void
}

export function LibraryPanel({ onAddToQueue, favorites, onToggleFavorite, onSearchDeezer }: Props) {
  const navigate = useNavigate()
  const [songs, setSongs] = useState<LibraryTrack[]>([])
  const [filter, setFilter] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [showFavsOnly, setShowFavsOnly] = useState(false)
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const load = useCallback(async () => {
    try {
      const data = await tracks.library()
      setSongs(data)
      setLoaded(true)
    } catch {
      toastRef.current.error('Failed to load library')
    }
  }, [])

  useEffect(() => {
    if (!loaded) load()
  }, [loaded, load])

  const filtered = useMemo(() => {
    let result = songs
    if (showFavsOnly && favorites) {
      result = result.filter(s => favorites.has(s.id))
    }
    if (filter) {
      const q = filter.toLowerCase()
      result = result.filter(s =>
        s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) => a.title.localeCompare(b.title))
  }, [songs, filter, showFavsOnly, favorites])

  const handleAddAll = useCallback(() => {
    const ready = filtered.filter(s => s.complete).slice(0, 50)
    ready.forEach(s => onAddToQueue(s.id, { title: s.title, artist: s.artist, img_url: s.img_url }))
    toast.success(`Added ${ready.length} songs to queue`)
  }, [filtered, onAddToQueue, toast])

  return (
    <>
      <div className={styles.controls}>
        <input
          type="text"
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
          >
            <FontAwesomeIcon icon={showFavsOnly ? faHeartSolid : faHeartRegular} />
          </button>
        )}
        <button className={styles.iconBtn} onClick={load} title="Refresh">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
        <button className={styles.iconBtn} onClick={handleAddAll} title="Add all to queue">
          <FontAwesomeIcon icon={faPlus} />
        </button>
        <button className={styles.iconBtn} onClick={() => navigate('/library')} title="Open full library">
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
        </button>
      </div>

      <div className={styles.grid}>
        {!loaded && Array.from({ length: 6 }, (_, i) => (
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
            <h3>{showFavsOnly ? 'No favorites yet' : filter ? 'No matches' : 'No songs yet'}</h3>
            <p>{showFavsOnly ? 'Heart some songs to see them here' : filter ? `No songs matching "${filter}"` : 'Process songs to build your library'}</p>
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
          return (
            <div
              key={song.id}
              className={styles.item}
              onClick={() => song.complete && onAddToQueue(song.id, { title: song.title, artist: song.artist, img_url: song.img_url })}
              style={{ cursor: song.complete ? 'pointer' : 'default' }}
              title={song.complete ? 'Click to add to queue' : 'Processing...'}
            >
              <div className={`${styles.thumbWrap} ${isFav ? styles.thumbFav : ''}`}>
                <img className={styles.thumb} src={song.img_url || '/logo.svg'} alt="" loading="lazy" />
              </div>
              <div className={styles.info}>
                <div className={styles.title}>{song.title}</div>
                <div className={styles.artist}>{song.artist}</div>
              </div>
              <div className={`${styles.status} ${song.complete ? styles.complete : styles.incomplete}`} />
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
