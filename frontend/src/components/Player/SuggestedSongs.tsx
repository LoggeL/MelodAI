import { useState, useEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlay } from '@fortawesome/free-solid-svg-icons'
import { tracks } from '../../services/api'
import type { LibraryTrack } from '../../types'
import styles from './SuggestedSongs.module.css'

interface Props {
  onSelect: (id: string, meta: { title: string; artist: string; img_url: string }) => void
}

function LmfLogo({ className }: { className?: string }) {
  return (
    <svg className={className} version="1.0" xmlns="http://www.w3.org/2000/svg"
      width="251" height="150" viewBox="0 0 2510 1500" fill="#d90429">
      <path d="M60 1387c0-4 174-779 210-932l51-222 21-93h129c71 0 129 1 129 3l-49 218c-144 634-172 756-177 772l-5 17h121v13c0 6-12 60-27 120l-28 107H248c-104 0-188-1-188-3z" />
      <path d="M622 858l139-625 21-93h288l2 238 3 237 141-235 140-235 163-3 163-3-4 13c-3 7-49 212-103 456l-98 442h-275l4-17c38-164 74-327 72-329-2-1-43 76-93 172l-90 174H900l-2-166-3-166-74 336-74 336H503l119-532z" />
      <path d="M810 1381c0-16 48-210 55-221l6-10h1280l-5 18-27 120-22 102H810v-9z" />
      <path d="M1550 1048l69-308 68-305 328-3 327-2-5 13c-2 7-15 59-27 115l-23 102h-414l-37 173-43 195-5 22h-119c-65 0-119-1-119-2z" />
      <path d="M1714 318l22-105 16-73h650l-5 23-23 105-17 82h-649l6-32z" />
    </svg>
  )
}

export function SuggestedSongs({ onSelect }: Props) {
  const [songs, setSongs] = useState<LibraryTrack[]>([])
  const [loaded, setLoaded] = useState(false)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    tracks.library().then(data => {
      const complete = data.filter((s: LibraryTrack) => s.complete)
      // Fisher-Yates shuffle
      for (let i = complete.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[complete[i], complete[j]] = [complete[j], complete[i]]
      }
      setSongs(complete.slice(0, 12))
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  if (!loaded) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>Pick a song</h2>
          <p className={styles.subtitle}>or search for something new</p>
        </div>
        <div className={styles.grid}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={styles.skeletonCard}>
              <div className={styles.skeletonArt} />
              <div className={styles.skeletonTitle} />
              <div className={styles.skeletonArtist} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (songs.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyHeader}>
          <LmfLogo className={styles.emptyLogo} />
          <h2 className={styles.title}>Welcome to MelodAI</h2>
          <p className={styles.subtitle}>Search for a song above to get started</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Pick a song</h2>
        <p className={styles.subtitle}>or search for something new</p>
      </div>
      <div className={styles.grid}>
        {songs.map((song, i) => (
          <div
            key={song.id}
            className={styles.card}
            onClick={() => onSelect(song.id, { title: song.title, artist: song.artist, img_url: song.img_url })}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className={styles.artWrap}>
              <img className={styles.art} src={song.img_url || '/logo.svg'} alt="" loading="lazy" />
              <div className={styles.playOverlay}>
                <FontAwesomeIcon icon={faPlay} />
              </div>
            </div>
            <div className={styles.cardTitle}>{song.title}</div>
            <div className={styles.cardArtist}>{song.artist}</div>
          </div>
        ))}
      </div>
      <div className={styles.branding}>
        <LmfLogo className={styles.brandingLogo} />
      </div>
    </div>
  )
}
