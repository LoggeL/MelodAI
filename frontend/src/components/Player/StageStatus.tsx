import type { CSSProperties } from 'react'
import type { QueueItem } from '../../types'
import { Cover } from '../common/Cover'
import { Icon } from '../common/Icon'
import { PIPELINE_STEPS, pipelineIndex } from '../../utils/pipeline'
import styles from './StageStatus.module.css'

/** Player stage while a song is still being prepared (§7.2 „processing“). */
export function StageProcessing({ track }: { track: QueueItem }) {
  const current = pipelineIndex(track.status, track.progress)
  const progress = Math.round(Math.max(0, Math.min(100, track.progress || 0)))
  return (
    <div className={styles.status} role="status" aria-live="polite">
      <div className={styles.track}>
        <Cover className={styles.cover} src={track.thumbnail} />
        <div className={styles.meta}>
          <span className="kicker">Wird vorbereitet</span>
          <strong className={styles.title}>{track.title}</strong>
          {track.artist && <span className={styles.artist}>{track.artist}</span>}
        </div>
      </div>
      <ol className={styles.steps} aria-label="Verarbeitung">
        {PIPELINE_STEPS.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'todo'
          return (
            <li key={step.no} className={styles.step} data-state={state} data-tone={index < 3 ? 'vocal' : 'inst'}
              aria-current={state === 'current' ? 'step' : undefined}>
              <span className={styles.no}>{state === 'done' ? <Icon name="check" size={16} /> : step.no}</span>
              <span className={styles.label}>{step.label}</span>
              {state === 'current' && <span className={styles.pct}>{progress} %</span>}
              {state === 'current' && <span className={`meter meter--inst meter--thin ${styles.bar}`} aria-hidden="true"><i style={{ '--v': `${progress}%` } as CSSProperties} /></span>}
              {state === 'done' && <span className="sr-only">erledigt</span>}
            </li>
          )
        })}
      </ol>
      <p className={styles.hint}>Neue Songs sind nach ca. 2 Minuten singbar.</p>
    </div>
  )
}

/** Player stage for a song that could not be prepared (§7.2 „track error“). */
export function StageError({ track, onRetry, onRemove }: { track: QueueItem; onRetry: () => void; onRemove?: () => void }) {
  return (
    <div className={styles.status}>
      <div className={`error-panel ${styles.error}`} role="alert">
        <Icon name="alert" size={24} />
        <h2>Dieser Song konnte nicht vorbereitet werden.</h2>
        <p>„{track.title}“{track.artist ? ` von ${track.artist}` : ''} ist gerade nicht singbar. Oft hilft ein zweiter Versuch.</p>
        <div className={styles.actions}>
          <button type="button" className="btn btn--primary" onClick={onRetry}><Icon name="redo" /> Erneut versuchen</button>
          {onRemove && <button type="button" className="btn" onClick={onRemove}><Icon name="trash" /> Aus der Setlist entfernen</button>}
        </div>
      </div>
    </div>
  )
}
