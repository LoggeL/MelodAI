import type { ReactNode } from 'react'
import type { QueueItem } from '../../types'
import { Cover } from '../common/Cover'
import { Icon } from '../common/Icon'
import { LyricScale } from './LyricScale'
import { Meters } from './Meters'
import { faderShort } from '../../utils/fader'
import styles from './StageMode.module.css'

/** Bühnenmodus top bar (§4.3): the current song on the left, „Danach auf der Bühne“ on the right. */
export function StageTop({ track, next, className = '' }: { track: QueueItem; next?: QueueItem; className?: string }) {
  return (
    <div className={`${styles.top} ${className}`}>
      <div className={styles.now}>
        <Cover className={styles.cover} src={track.thumbnail} />
        <div className={styles.meta}>
          <strong>{track.title}</strong>
          <span>{track.artist}</span>
        </div>
      </div>
      {next && (
        <div className={styles.next}>
          <span className="kicker">Danach auf der Bühne</span>
          <strong>{next.title}</strong>
          <span>{next.artist}</span>
        </div>
      )}
    </div>
  )
}

interface DeskProps {
  transport: ReactNode
  vocalsVolume: number
  instrumentalVolume: number
  lyricScale: number
  onLyricScale?: (scale: number) => void
  onExit: () => void
}

/** Bühnenmodus bottom row (§4.3): mini meters, transport, A−/A+, key hints and the exit button. */
export function StageDeskRow({ transport, vocalsVolume, instrumentalVolume, lyricScale, onLyricScale, onExit }: DeskProps) {
  return (
    <div className={styles.row}>
      <span className={styles.meter}><Meters vocals={vocalsVolume} instrumental={instrumentalVolume} />
        <span>Gesang {faderShort(vocalsVolume)} · Instrumental {faderShort(instrumentalVolume)}</span></span>
      <div>{transport}</div>
      <div className={styles.end}>
        {onLyricScale && <LyricScale value={lyricScale} onChange={onLyricScale} />}
        <span className={styles.hints}>Esc verlassen · Leertaste Pause</span>
        <button type="button" className="iconbtn iconbtn--outline" aria-label="Bühnenmodus verlassen (Esc)" title="Bühnenmodus verlassen (Esc)" onClick={onExit}>
          <Icon name="x" />
        </button>
      </div>
    </div>
  )
}
