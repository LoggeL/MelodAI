import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHeadphones, faPause, faPlay, faListUl, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { HeartButton } from '../../components/HeartButton/HeartButton'
import type { LibraryTrack, ProcessingStatus } from '../../types'
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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--'
  const duration = Math.floor(seconds)
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
}

export function TrackCollection({ songs, viewMode, favorites, statuses, pending, previewId, previewProgress,
  onPlay, onFavorite, onPreview, onPlaylist, onRetry }: Props) {
  const grid = viewMode === 'grid'
  return (
    <div className={grid ? styles.grid : styles.listView}>
      {!grid && <div className={styles.listHeader} aria-hidden="true">
        <div className={styles.listColArt} /><div className={styles.listColTitle}>Title</div>
        <div className={styles.listColAlbum}>Album</div><div className={styles.listColDuration}>Duration</div>
        <div className={styles.listColActions}>Actions</div>
      </div>}
      {songs.map(song => {
        const favorite = favorites.has(song.id)
        const previewing = previewId === song.id
        const status = statuses[song.id]
        const failed = !song.complete && status?.status === 'error'
        const progress = Math.min(100, Math.max(0, status?.progress || 0))
        const description = failed ? 'Processing failed' : status?.detail || status?.status || 'Queued'
        const actions = <>
          <HeartButton active={favorite} onClick={() => onFavorite(song.id)} disabled={pending.has(`favorite:${song.id}`)}
            className={styles.listFavBtn} activeClassName={styles.listFavActive}
            title={`${favorite ? 'Remove' : 'Add'} ${song.title} ${favorite ? 'from' : 'to'} favorites`} />
          <button type="button" className={`${styles.listActionBtn} ${previewing ? styles.listActionBtnActive : ''}`}
            onClick={() => onPreview(song.id)} aria-pressed={previewing}
            title={previewing ? 'Stop preview' : 'Preview 30 seconds'} aria-label={`${previewing ? 'Stop preview of' : 'Preview'} ${song.title}`}>
            <FontAwesomeIcon icon={previewing ? faPause : faHeadphones} />
          </button>
          <button type="button" className={styles.listActionBtn} onClick={() => onPlaylist(song.id)}
            title="Playlist options" aria-label={`Playlist options for ${song.title}`} aria-haspopup="dialog">
            <FontAwesomeIcon icon={faListUl} />
          </button>
        </>
        const retry = <button type="button" className={grid ? styles.reprocessBtn : styles.listReprocessBtn}
          onClick={() => onRetry(song.id)} disabled={pending.has(`retry:${song.id}`)}>
          <FontAwesomeIcon icon={faRotateRight} /> {pending.has(`retry:${song.id}`) ? 'Retrying...' : 'Retry'}
        </button>
        const cover = <img src={grid ? hiResCover(song.img_url) : song.img_url || '/logo.svg'} alt="" loading="lazy"
          className={grid ? undefined : styles.listThumb} />
        return grid ? (
          <article key={song.id} className={`${styles.card} ${previewing ? styles.cardPreviewing : ''} ${!song.complete ? styles.cardProcessing : ''}`}>
            <div className={styles.cardArt}>
              {song.complete ? <button type="button" className={styles.artPlayButton} onClick={() => onPlay(song)} aria-label={`Play ${song.title} by ${song.artist}`}>
                {cover}<span className={styles.karaokeHint}><FontAwesomeIcon icon={faPlay} /></span>
              </button> : cover}
              {!song.complete && <div className={styles.processingOverlay}>
                <div className={styles.processingProgress}>{failed ? 'Failed' : `${Math.round(progress)}%`}</div>
                <div className={styles.processingDetail}>{description}</div>
                {failed ? retry : <div className={styles.processingBar} role="progressbar" aria-label={`Processing ${song.title}`} aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
                  <div className={styles.processingBarFill} style={{ width: `${progress}%` }} />
                </div>}
              </div>}
              {previewing && <div className={styles.previewBar}><div className={styles.previewFill} style={{ width: `${previewProgress}%` }} /></div>}
            </div>
            <div className={styles.cardBody}><h3 className={styles.cardTitle} title={song.title}>{song.title}</h3><div className={styles.cardArtist} title={song.artist}>{song.artist}</div></div>
            {song.complete && <div className={styles.cardActions}>{actions}</div>}
          </article>
        ) : (
          <article key={song.id} className={`${styles.listRow} ${previewing ? styles.listRowPreviewing : ''}`}>
            <div className={styles.listColArt}>
              <button type="button" className={`${styles.listThumbWrap} ${styles.artPlayButton}`} disabled={!song.complete}
                onClick={() => onPlay(song)} aria-label={`Play ${song.title} by ${song.artist}`}>
                {cover}{song.complete && <span className={styles.listThumbPlayOverlay}><FontAwesomeIcon icon={faPlay} /></span>}
              </button>
            </div>
            <div className={styles.listColTitle}><h3 className={styles.listTitle} title={song.title}>{song.title}</h3>
              <div className={styles.listArtist}>{song.artist}</div>
              {!song.complete && <div className={styles.listStatusDetail}>{description}</div>}
            </div>
            <div className={styles.listColAlbum}><span className={styles.listAlbumText}>{song.album}</span></div>
            <div className={styles.listColDuration}>{formatDuration(song.duration)}</div>
            <div className={styles.listColActions}>{song.complete ? actions : failed ? retry : <span className={styles.listProcessing}>{Math.round(progress)}%</span>}</div>
            {previewing && <div className={styles.listPreviewBar}><div className={styles.previewFill} style={{ width: `${previewProgress}%` }} /></div>}
            {!song.complete && !failed && <div className={styles.listProcessingBar} role="progressbar" aria-label={`Processing ${song.title}`} aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
              <div className={styles.processingBarFill} style={{ width: `${progress}%` }} />
            </div>}
          </article>
        )
      })}
    </div>
  )
}
