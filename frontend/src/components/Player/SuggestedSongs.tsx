import { useState, useEffect, useCallback } from 'react'
import { tracks } from '../../services/api'
import type { LibraryTrack, SongMeta } from '../../types'
import { Cover } from '../common/Cover'
import { Icon } from '../common/Icon'
import { de } from '../../utils/messages'
import styles from './SuggestedSongs.module.css'

interface Props {
  onSelect: (id: string, meta: SongMeta) => void
  /** Opens the search (popover on desktop, sheet on phones). */
  onSearch?: () => void
}

/** Empty stage (§7.2 „no song“): „Bühne frei“, a search button and suggestions. */
export function SuggestedSongs({ onSelect, onSearch }: Props) {
  const [songs, setSongs] = useState<LibraryTrack[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    setLoaded(false); setError('')
    tracks.library().then(data => {
      const complete = data.filter(song => song.complete)
      for (let i = complete.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [complete[i], complete[j]] = [complete[j], complete[i]]
      }
      setSongs(complete.slice(0, 8))
    }).catch(err => setError(err instanceof Error ? de(err.message) : 'Die Vorschläge konnten nicht geladen werden.'))
      .finally(() => setLoaded(true))
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <span className="kicker">Bühne frei</span>
        <h2 className={styles.title}>Such dir einen Song aus.</h2>
        {onSearch && (
          <button type="button" className={`btn btn--pill ${styles.search}`} onClick={onSearch}>
            <Icon name="search" /> Song oder Interpret suchen
          </button>
        )}
      </div>

      {error ? (
        <div className="error-panel" role="alert">
          <Icon name="alert" size={24} />
          <h3>Die Vorschläge konnten nicht geladen werden.</h3>
          <p>{error}</p>
          <button type="button" className="btn" onClick={load}><Icon name="redo" /> Erneut versuchen</button>
        </div>
      ) : (!loaded || songs.length > 0) && (
        <section className={styles.suggestions} aria-labelledby="suggestions-title" aria-busy={!loaded}>
          <h3 id="suggestions-title" className="kicker">Vorschläge</h3>
          <div className={styles.grid}>
            {!loaded ? Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={styles.skeletonCard} aria-hidden="true">
                <div className={`skeleton ${styles.skeletonArt}`} />
                <div className={`skeleton ${styles.skeletonLine}`} />
                <div className={`skeleton ${styles.skeletonLine} ${styles.short}`} />
              </div>
            )) : songs.map(song => (
              <button type="button" key={song.id} className={styles.card}
                aria-label={`${song.title} von ${song.artist} abspielen`}
                onClick={() => onSelect(song.id, { title: song.title, artist: song.artist, img_url: song.img_url, duration: song.duration })}>
                <span className={styles.artWrap}>
                  <Cover className={styles.art} src={song.img_url} />
                  <span className={styles.playOverlay} aria-hidden="true"><Icon name="play" size={22} /></span>
                </span>
                <span className={styles.cardTitle}>{song.title}</span>
                <span className={styles.cardArtist}>{song.artist}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
