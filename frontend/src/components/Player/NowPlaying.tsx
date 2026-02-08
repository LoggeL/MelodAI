import { useState, useCallback } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faShareNodes } from '@fortawesome/free-solid-svg-icons'
import type { QueueItem } from '../../types'
import { useToast } from '../../hooks/useToast'
import { HeartButton } from '../HeartButton/HeartButton'
import styles from './NowPlaying.module.css'

interface Props {
  track: QueueItem | null
  isFavorite?: boolean
  onToggleFavorite?: (trackId: string) => void
}

export function NowPlaying({ track, isFavorite, onToggleFavorite }: Props) {
  const [showDownload, setShowDownload] = useState(false)
  const toast = useToast()

  const handleDownload = useCallback(async (type: string) => {
    if (!track) return
    setShowDownload(false)
    const fileMap: Record<string, string> = { vocals: 'vocals.mp3', no_vocals: 'no_vocals.mp3', song: 'song.mp3' }
    const labelMap: Record<string, string> = { vocals: 'Vocals', no_vocals: 'Instrumental', song: 'Full' }
    const url = `/songs/${track.id}/${fileMap[type]}`
    const filename = `${track.artist} - ${track.title} (${labelMap[type]}).mp3`

    toast.success(`Downloading ${labelMap[type]}...`)
    try {
      const resp = await fetch(url)
      const blob = await resp.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      toast.error('Download failed')
    }
  }, [track, toast])

  const handleShare = useCallback(() => {
    if (!track) return
    const url = `${window.location.origin}/song/${track.id}`
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link copied to clipboard!'),
      () => toast.warning('Could not copy link')
    )
  }, [track, toast])

  if (!track) return null

  return (
    <div className={styles.wrapper}>
      <img className={styles.art} src={track.thumbnail || '/logo.svg'} alt="" />
      <div className={styles.info}>
        <div className={styles.title}>{track.title}</div>
        <div className={styles.artist}>{track.artist}</div>
      </div>
      <div className={styles.actions}>
        {onToggleFavorite && (
          <HeartButton
            active={isFavorite || false}
            onClick={() => onToggleFavorite(track.id)}
            className={styles.btn}
            activeClassName={styles.favActive}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          />
        )}
        <div className={styles.downloadWrapper}>
          <button className={styles.btn} onClick={() => setShowDownload(!showDownload)} title="Download">
            <FontAwesomeIcon icon={faDownload} />
          </button>
          {showDownload && (
            <div className={styles.dropdown}>
              <button className={styles.dropdownOption} onClick={() => handleDownload('vocals')}>Vocals Only</button>
              <button className={styles.dropdownOption} onClick={() => handleDownload('no_vocals')}>Instrumental Only</button>
              <button className={styles.dropdownOption} onClick={() => handleDownload('song')}>Full Song</button>
            </div>
          )}
        </div>
        <button className={styles.btn} onClick={handleShare} title="Share">
          <FontAwesomeIcon icon={faShareNodes} />
        </button>
      </div>
    </div>
  )
}
