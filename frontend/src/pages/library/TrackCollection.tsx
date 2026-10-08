import type { CSSProperties } from 'react'
import { HeartButton } from '../../components/HeartButton/HeartButton'
import { Icon } from '../../components/common/Icon'
import { Cover } from '../../components/common/Cover'
import type { LibraryTrack, ProcessingStatus } from '../../types'
import { formatDuration } from '../../utils/format'
import { pipelineLabel } from '../../utils/pipeline'
import styles from '../LibraryPage.module.css'
import { hiResCover } from './trackPresentation'

interface Props {
  songs: LibraryTrack[]
  viewMode: 'grid' | 'list'
  favorites: Set<string>
  statuses: Record<string, ProcessingStatus>
  pending: Set<string>
  previewId: string | null
  previewProgress: number
  onPlay: (song: LibraryTrack) => void
  onFavorite: (id: string) => void
  onPreview: (id: string) => void
  onPlaylist: (id: string) => void
  onRetry: (id: string) => void
}

export function TrackCollection({ songs, viewMode, favorites, statuses, pending, previewId, previewProgress,
  onPlay, onFavorite, onPreview, onPlaylist, onRetry }: Props) {
  const grid = viewMode === 'grid'

  const parts = (song: LibraryTrack) => {
    const favorite = favorites.has(song.id)
    const previewing = previewId === song.id
    const status = statuses[song.id]
    const failed = !song.complete && status?.status === 'error'
    const progress = Math.round(Math.min(100, Math.max(0, status?.progress || 0)))
    const known = !!status?.status
    const label = failed ? 'Fehlgeschlagen' : known ? pipelineLabel(status?.status, progress) : 'Unvollständig'
    const actions = <>
      <HeartButton active={favorite} onClick={() => onFavorite(song.id)} disabled={pending.has(`favorite:${song.id}`)}
        className="iconbtn iconbtn--sm" size={18}
        title={favorite ? `${song.title} aus Favoriten entfernen` : `${song.title} zu Favoriten hinzufügen`} />
      <button type="button" className={`iconbtn iconbtn--sm ${previewing ? styles.actionOn : ''}`}
        onClick={() => onPreview(song.id)} aria-pressed={previewing}
        title={previewing ? 'Vorhören stoppen' : '30 Sekunden vorhören'} aria-label={`${previewing ? 'Vorhören stoppen:' : 'Vorhören:'} ${song.title}`}>
        <Icon name={previewing ? 'pause' : 'headphones'} size={18} />
      </button>
      <button type="button" className="iconbtn iconbtn--sm" onClick={() => onPlaylist(song.id)}
        title="Zur Playlist hinzufügen" aria-label={`Playlist-Optionen für ${song.title}`} aria-haspopup="dialog">
        <Icon name="list" size={18} />
      </button>
    </>
    const retry = <button type="button" className="btn btn--sm" onClick={() => onRetry(song.id)} disabled={pending.has(`retry:${song.id}`)}>
      <Icon name="redo" size={16} /> {pending.has(`retry:${song.id}`) ? 'Läuft …' : 'Erneut'}
    </button>
    return { favorite, previewing, failed, known, progress, label, actions, retry }
  }

  if (grid) {
    return (
      <div className={styles.grid}>
        {songs.map(song => {
          const { previewing, failed, known, progress, label, actions, retry } = parts(song)
          return (
            <article key={song.id} className={`${styles.card} ${!song.complete ? styles.cardProcessing : ''}`}>
              <div className={styles.cardArt}>
                <Cover className={styles.cardCover} src={hiResCover(song.img_url)} />
                {song.complete && (
                  <button type="button" className={`playdisc ${styles.cardPlay}`} onClick={() => onPlay(song)} aria-label={`${song.title} von ${song.artist} abspielen`}>
                    <Icon name="play" size={22} />
                  </button>
                )}
                {!song.complete && (
                  <div className={styles.cardState}>
                    <span className={`chip ${failed ? 'chip--err' : known ? 'chip--work' : ''}`}>{label}</span>
                    {failed ? retry : known && (
                      <span className={`meter meter--inst meter--thin ${styles.cardBar}`} role="progressbar" aria-label={`Verarbeitung ${song.title}`}
                        aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ '--v': `${progress}%` } as CSSProperties} /></span>
                    )}
                  </div>
                )}
                {previewing && <span className={`meter meter--thin ${styles.previewBar}`} aria-hidden="true"><i style={{ '--v': `${previewProgress}%` } as CSSProperties} /></span>}
              </div>
              <h3 className={styles.cardTitle} title={song.title}>{song.title}</h3>
              <div className={styles.cardArtist} title={song.artist}>{song.artist}</div>
              {song.complete && (
                <div className={styles.cardMeta}>
                  <span className={styles.duration}>{song.duration > 0 ? formatDuration(song.duration) : '–:–'}</span>
                  <span className={styles.cardActions}>{actions}</span>
                </div>
              )}
            </article>
          )
        })}
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table className={`table ${styles.listTable}`}>
        <thead>
          <tr>
            <th className={`num ${styles.hideSm}`} scope="col">#</th>
            <th scope="col"><span className="sr-only">Cover</span></th>
            <th scope="col">Titel</th>
            <th scope="col" className={styles.hideSm}>Album</th>
            <th scope="col" className={`num ${styles.hideSm}`}>Dauer</th>
            <th scope="col"><span className="sr-only">Aktionen</span></th>
          </tr>
        </thead>
        <tbody>
          {songs.map((song, index) => {
            const { previewing, failed, known, progress, label, actions, retry } = parts(song)
            return (
              <tr key={song.id} className={previewing ? styles.rowPreviewing : undefined}>
                <td className={`num ${styles.hideSm}`}>{String(index + 1).padStart(2, '0')}</td>
                <td className={styles.thumbCell}>
                  <button type="button" className={styles.thumbButton} disabled={!song.complete}
                    onClick={() => onPlay(song)} aria-label={`${song.title} von ${song.artist} abspielen`}>
                    <Cover className={styles.listThumb} src={song.img_url} />
                    {song.complete && <span className={styles.thumbPlay} aria-hidden="true"><Icon name="play" size={16} /></span>}
                  </button>
                </td>
                <td className={styles.titleCell}>
                  <div className={styles.listTitle}>{song.title}</div>
                  <div className={styles.listArtist}>{song.artist}</div>
                  {!song.complete && <div className={failed ? styles.listFailed : known ? styles.listWork : styles.listMuted}>{label}</div>}
                  {!song.complete && !failed && known && <span className={`meter meter--inst meter--thin ${styles.listBar}`} role="progressbar" aria-label={`Verarbeitung ${song.title}`}
                    aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ '--v': `${progress}%` } as CSSProperties} /></span>}
                </td>
                <td className={`${styles.hideSm} ${styles.albumCell}`}>{song.album}</td>
                <td className={`num ${styles.hideSm}`}>{song.duration > 0 ? formatDuration(song.duration) : '–:–'}</td>
                <td className={styles.actionsCell}>{song.complete ? actions : failed ? retry : null}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
