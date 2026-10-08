import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { tracks } from '../../services/api'
import type { LibraryTrack, ProcessingStatus } from '../../types'
import { useToast } from '../../hooks/useToast'
import { HeartButton } from '../HeartButton/HeartButton'
import { Icon } from '../common/Icon'
import { Cover } from '../common/Cover'
import { de } from '../../utils/messages'
import { pipelineLabel } from '../../utils/pipeline'
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
      if (request === requestRef.current) setError(err instanceof Error ? de(err.message) : 'Die Bibliothek konnte nicht geladen werden.')
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
    toast.success(`${ready.length} ${ready.length === 1 ? 'Song' : 'Songs'} zur Setlist hinzugefügt.`)
  }, [filtered, onAddToQueue, toast])

  return (
    <>
      <div className={styles.controls}>
        <label className={styles.filterWrap}>
          <span className="sr-only">Bibliothek filtern</span>
          <Icon name="filter" size={16} className={styles.filterIcon} />
          <input
            type="search"
            className={styles.filterInput}
            placeholder="Bibliothek filtern"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </label>
        {favorites && (
          <button
            type="button"
            className={`iconbtn iconbtn--sm ${showFavsOnly ? styles.iconBtnActive : ''}`}
            onClick={() => setShowFavsOnly(!showFavsOnly)}
            title="Nur Favoriten"
            aria-label="Nur Favoriten zeigen"
            aria-pressed={showFavsOnly}
          >
            <Icon name={showFavsOnly ? 'heart-filled' : 'heart'} size={18} />
          </button>
        )}
        <button type="button" className="iconbtn iconbtn--sm" disabled={loading} onClick={load} title="Aktualisieren" aria-label="Bibliothek aktualisieren">
          <Icon name="redo" size={18} />
        </button>
      </div>
      <div className={styles.subControls}>
        <button type="button" className="btn btn--sm" disabled={!filtered.some(song => song.complete)} onClick={handleAddAll}
          title="Bis zu 50 fertige Songs zur Setlist hinzufügen">
          <Icon name="plus" size={16} /> Alle hinzufügen
        </button>
        <button type="button" className={`btn btn--sm btn--ghost ${styles.openLink}`} onClick={() => navigate('/library')}>
          Bibliothek öffnen <Icon name="chevron-right" size={16} />
        </button>
      </div>

      <div className={styles.grid}>
        {error && (
          <div className="error-panel" role="alert">
            <Icon name="alert" size={24} />
            <h3>Die Bibliothek ist gerade nicht erreichbar.</h3>
            <p>{error}</p>
            <button type="button" className="btn" onClick={load} disabled={loading}><Icon name="redo" /> Erneut versuchen</button>
          </div>
        )}
        {!loaded && loading && Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.skeletonItem} aria-hidden="true">
            <div className={`skeleton ${styles.skeletonThumb}`} />
            <div className={styles.skeletonInfo}>
              <div className={`skeleton ${styles.skeletonTitle}`} />
              <div className={`skeleton ${styles.skeletonArtist}`} />
            </div>
          </div>
        ))}
        {filtered.length === 0 && loaded && (
          <div className="emptyState">
            <Icon name={showFavsOnly && !filter.trim() ? 'heart' : 'library'} size={48} />
            <h3>{filter.trim() ? `Kein Song passt zu „${filter.trim()}“.` : showFavsOnly ? 'Noch keine Favoriten.' : 'Noch keine Songs.'}</h3>
            <p>{filter.trim() ? 'Vielleicht ist er noch nicht geladen.' : showFavsOnly ? 'Tipp aufs Herz bei einem Song.' : 'Such einen Song, er landet danach hier.'}</p>
            {filter.trim() && (
              <div className="actions">
                <button type="button" className="btn" onClick={() => setFilter('')}>Filter zurücksetzen</button>
                {onSearchDeezer && <button type="button" className="btn btn--primary" onClick={() => onSearchDeezer(filter)}><Icon name="search" /> Im Katalog suchen</button>}
              </div>
            )}
          </div>
        )}
        {filtered.map(song => {
          const isFav = favorites?.has(song.id)
          const status = statuses[song.id]
          const failed = !song.complete && status?.status === 'error'
          const processing = !song.complete && statusCheck === 'ready' && ACTIVE_STATUSES.has(status?.status)
          const progress = Math.round(Math.min(100, Math.max(0, status?.progress || 0)))
          const statusLabel = song.complete ? 'Bereit' : failed ? 'Verarbeitung fehlgeschlagen'
            : processing ? pipelineLabel(status?.status, progress)
            : statusCheck === 'pending' ? 'Status wird geprüft'
            : statusCheck === 'unavailable' ? 'Status nicht verfügbar' : 'Nicht bereit'
          return (
            <div key={song.id} className={styles.item}>
              <button type="button" className={styles.songButton} disabled={!song.complete}
                onClick={() => onAddToQueue(song.id, { title: song.title, artist: song.artist, img_url: song.img_url })}
                aria-label={song.complete ? `${song.title} von ${song.artist} zur Setlist hinzufügen` : `${song.title}: ${statusLabel}`}
                title={song.complete ? 'Zur Setlist hinzufügen' : failed ? de(status?.detail || '') || statusLabel : statusLabel}>
                <Cover className={styles.thumb} src={song.img_url} />
                <span className={styles.info}>
                  <span className={styles.title}>{song.title}</span>
                  <span className={styles.artist}>{song.artist}</span>
                  {!song.complete && <span className={`${styles.statusText} ${failed ? styles.failedText : processing ? styles.workText : ''}`}>{statusLabel}</span>}
                </span>
                <span className={`${styles.status} ${song.complete ? styles.complete : failed ? styles.failed : processing ? styles.incomplete : styles.unknown}`} aria-hidden="true" />
              </button>
              {onToggleFavorite && (
                <HeartButton
                  active={!!isFav}
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(song.id) }}
                  className="iconbtn iconbtn--sm"
                  size={16}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
